import asyncio
import json
import logging
import os
from typing import Any

import httpx
from google import genai
from google.genai import types as genai_types

from services.flood_service import (
    FloodService,
    NIWA_FLOOD_PLAINS_URL,
    NIWA_RIVER_NETWORK_URL,
)
from services.linz_service import LINZService
from services.police_service import PoliceService
from services.rent_service import RentService
from services.seismic_service import SeismicService
from services.traffic_service import TrafficService, TRAFFIC_LINES_URL
from services.supabase_service import SupabaseService

logger = logging.getLogger(__name__)

_RADIUS_DEG = 0.005  # ~500m bounding box (suburb/meshblock level)


def _build_bbox(lat: float, lng: float, radius: float = _RADIUS_DEG) -> list[float]:
    return [lng - radius, lat - radius, lng + radius, lat + radius]


class AgentService:
    def __init__(self) -> None:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            logger.warning("GEMINI_API_KEY is not set – report synthesis will fail.")
        self._client = genai.Client(api_key=api_key)

        self._linz = LINZService()
        self._flood = FloodService()
        self._police = PoliceService()
        self._rent = RentService()
        self._seismic = SeismicService()
        self._traffic = TrafficService()
        self._supabase = SupabaseService()

    # ------------------------------------------------------------------ #
    #  Data-gathering helpers                                              #
    # ------------------------------------------------------------------ #

    async def _fetch_property(self, lat: float, lng: float) -> dict[str, Any]:
        try:
            data = await self._linz.get_all_data_by_coords(lat, lng)
            return data or {}
        except Exception as exc:
            logger.warning("LINZ property lookup failed: %s", exc)
            return {}

    async def _fetch_flood(self, lat: float, lng: float) -> dict[str, Any]:
        bbox = _build_bbox(lat, lng)

        plains_url = self._flood.get_query_url_with_bbox(NIWA_FLOOD_PLAINS_URL, bbox, limit=10)
        rivers_url = self._flood.get_query_url_with_bbox(NIWA_RIVER_NETWORK_URL, bbox, limit=10)

        result: dict[str, Any] = {}
        async with httpx.AsyncClient(timeout=15) as client:
            for key, url in [("coastal_plains", plains_url), ("river_network", rivers_url)]:
                try:
                    resp = await client.get(url)
                    resp.raise_for_status()
                    data = resp.json()
                    features = data.get("features", [])
                    result[key] = {
                        "feature_count": len(features),
                        "properties": [f.get("properties", {}) for f in features[:5]],
                    }
                except Exception as exc:
                    logger.warning("Flood fetch failed for %s: %s", key, exc)
                    result[key] = {"feature_count": 0, "error": str(exc)}

            # Hamilton-specific hazard layer if in range
            if 174.9 <= lng <= 175.6 and -38.2 <= lat <= -37.4:
                hamilton_url = self._flood.get_query_url_with_bbox(
                    "https://maps.hamilton.govt.nz/server/rest/services/hcc_entpublic/portal_floodviewer_floodhazard/FeatureServer/1",
                    bbox,
                    limit=10,
                    out_fields="OBJECTID,Hazard_Factor,Storm_Event",
                )
                try:
                    resp = await client.get(hamilton_url)
                    resp.raise_for_status()
                    data = resp.json()
                    features = data.get("features", [])
                    result["hamilton_flood_hazard"] = {
                        "feature_count": len(features),
                        "properties": [f.get("properties", {}) for f in features[:5]],
                    }
                except Exception as exc:
                    logger.warning("Hamilton flood fetch failed: %s", exc)
                    result["hamilton_flood_hazard"] = {"feature_count": 0, "error": str(exc)}

        return result

    async def _fetch_seismic(self, lat: float, lng: float) -> dict[str, Any]:
        # Tier 1: Fault Rupture (Critical Setback - 50m)
        bbox_faults = _build_bbox(lat, lng, radius=0.0005)
        # Tier 2: Soil Stability/Liquefaction Context (500m)
        bbox_local = _build_bbox(lat, lng, radius=0.005)
        # Tier 3: Historical Activity & Shaking (20km)
        bbox_regional = _build_bbox(lat, lng, radius=0.2)

        result: dict[str, Any] = {}
        async with httpx.AsyncClient(timeout=20) as client:
            # Query URLs
            fault_url = self._seismic.get_fault_lines_query_url_with_bbox(*bbox_faults)
            quake_local_url = self._seismic.get_earthquakes_query_url_with_bbox(*bbox_local, limit=10)
            quake_regional_url = self._seismic.get_earthquakes_query_url_with_bbox(*bbox_regional, limit=20)

            queries = [
                ("immediate_fault_lines", fault_url),
                ("local_soil_activity", quake_local_url),
                ("regional_seismic_history", quake_regional_url)
            ]

            for key, url in queries:
                try:
                    resp = await client.get(url)
                    resp.raise_for_status()
                    data = resp.json()
                    features = data.get("features", [])
                    result[key] = {
                        "feature_count": len(features),
                        "properties": [f.get("properties", {}) for f in features[:10]],
                    }
                except Exception as exc:
                    logger.warning("Seismic fetch failed for %s: %s", key, exc)
                    result[key] = {"feature_count": 0, "error": str(exc)}
        return result

    def _fetch_crime(self, lat: float, lng: float) -> dict[str, Any]:
        bbox = _build_bbox(lat, lng)
        try:
            data = self._police.get_police_incidents_for_extent(*bbox)
            features = data.get("features", [])
            if not features:
                return {"feature_count": 0, "summary": "No crime data within 1.5 km."}

            total = sum(
                f.get("properties", {}).get("victimisation_sum", 0) for f in features
            )
            breakdown: dict[str, int] = {}
            for f in features:
                for crime_type, count in (
                    f.get("properties", {}).get("crime_breakdown", {}) or {}
                ).items():
                    breakdown[crime_type] = breakdown.get(crime_type, 0) + int(count)

            top_crimes = sorted(breakdown.items(), key=lambda x: x[1], reverse=True)[:5]
            return {
                "meshblock_count": len(features),
                "total_victimisations": total,
                "top_crime_types": [{"type": t, "count": c} for t, c in top_crimes],
            }
        except Exception as exc:
            logger.warning("Crime data fetch failed: %s", exc)
            return {"error": str(exc)}

    async def _fetch_rent(self, lat: float, lng: float) -> dict[str, Any]:
        try:
            areas = await self._rent.get_area_definitions()
            if not areas:
                return {"available": False, "reason": "No area definitions returned from MBIE."}

            first_area_id = areas[0].get("area-definition") if areas else None
            if not first_area_id:
                return {"available": False, "reason": "Area definition ID could not be resolved."}

            stats = await self._rent.get_rent_statistics(str(first_area_id))
            items = stats.get("statistics", [])

            summary = [
                {
                    "type": item.get("dwelling-type", "Unknown"),
                    "bedrooms": item.get("num-bedrooms", "Any"),
                    "median_rent_nzd": item.get("median-rent"),
                    "count": item.get("count"),
                }
                for item in items[:8]
            ]
            return {"area_id": first_area_id, "rent_samples": summary}
        except Exception as exc:
            logger.warning("Rent data fetch failed: %s", exc)
            return {"error": str(exc)}

    async def _fetch_traffic(self, lat: float, lng: float) -> dict[str, Any]:
        bbox = _build_bbox(lat, lng, radius=0.05)
        result: dict[str, Any] = {}
        async with httpx.AsyncClient(timeout=15) as client:
            sh_url = self._traffic.get_query_url_with_bbox(TRAFFIC_LINES_URL, bbox, limit=10)
            try:
                resp = await client.get(sh_url)
                resp.raise_for_status()
                features = resp.json().get("features", [])
                aadt_values = [
                    f.get("properties", {}).get("AADT")
                    for f in features
                    if f.get("properties", {}).get("AADT")
                ]
                result["state_highways"] = {
                    "segment_count": len(features),
                    "aadt_values": aadt_values[:5],
                }
            except Exception as exc:
                logger.warning("State highway traffic fetch failed: %s", exc)
                result["state_highways"] = {"error": str(exc)}

        return result

    # ------------------------------------------------------------------ #
    #  RAG / Knowledge retrieval                                         #
    # ------------------------------------------------------------------ #

    def _get_query_embedding(self, text: str) -> list[float]:
        try:
            result = self._client.models.embed_content(
                model="models/gemini-embedding-2",
                contents=text,
                config=genai_types.EmbedContentConfig(
                    task_type="RETRIEVAL_QUERY",
                    output_dimensionality=768
                )
            )
            return result.embeddings[0].values
        except Exception as exc:
            logger.error(f"Error generating query embedding: {exc}")
            return []

    async def _fetch_rag_context(self, queries: list[str], doc_type: str = "building_code") -> str:
        """
        Retrieves relevant building code or district plan snippets for the given queries.
        """
        all_snippets = []
        for q in queries:
            emb = self._get_query_embedding(q)
            if not emb:
                continue
            
            matches = self._supabase.search_regulatory_documents(emb, doc_type=doc_type, match_count=2)
            for m in matches:
                content = m.get("content", "")
                if content not in all_snippets:
                    all_snippets.append(content)
        
        return "\n\n---\n\n".join(all_snippets)

    # ------------------------------------------------------------------ #
    #  Report synthesis                                                    #
    # ------------------------------------------------------------------ #

    async def generate_report(
        self, lat: float, lng: float, address: str, user_type: str = "buyer"
    ) -> dict[str, Any]:
        prop_task = asyncio.create_task(self._fetch_property(lat, lng))
        flood_task = asyncio.create_task(self._fetch_flood(lat, lng))
        seismic_task = asyncio.create_task(self._fetch_seismic(lat, lng))
        rent_task = asyncio.create_task(self._fetch_rent(lat, lng))
        traffic_task = asyncio.create_task(self._fetch_traffic(lat, lng))

        prop_data, flood_data, seismic_data, rent_data, traffic_data = await asyncio.gather(
            prop_task, flood_task, seismic_task, rent_task, traffic_task,
            return_exceptions=True,
        )

        def safe(val: Any) -> Any:
            return val if not isinstance(val, Exception) else {"error": str(val)}

        prop_data = safe(prop_data)
        flood_data = safe(flood_data)
        seismic_data = safe(seismic_data)
        rent_data = safe(rent_data)
        traffic_data = safe(traffic_data)

        crime_data = self._fetch_crime(lat, lng)

        # RAG: Fetch relevant building code snippets based on detected risks
        rag_queries = ["general property compliance"]
        if flood_data.get("coastal_plains", {}).get("feature_count", 0) > 0 or \
           flood_data.get("hamilton_flood_hazard", {}).get("feature_count", 0) > 0:
            rag_queries.append("Surface water drainage and flood protection E1")
        
        if seismic_data.get("immediate_fault_lines", {}).get("feature_count", 0) > 0:
            rag_queries.append("Structural safety and earthquake resilience B1")
            
        rag_context = await self._fetch_rag_context(rag_queries, doc_type="building_code")

        # District Plan RAG: Specifically for Hamilton
        is_hamilton = 174.9 <= lng <= 175.6 and -38.2 <= lat <= -37.4
        if is_hamilton:
            plan_queries = ["residential zoning rules", "building setbacks and height limits", "site coverage"]
            plan_context = await self._fetch_rag_context(plan_queries, doc_type="district_plan")
            rag_context += "\n\n### HAMILTON DISTRICT PLAN INSIGHTS:\n" + plan_context

        persona = "expert property investment analyst" if user_type == "buyer" else "lifestyle and rental market analyst"
        focus_area = "long-term structural integrity, capital risk, and regulatory compliance" if user_type == "buyer" else "living standards, neighborhood safety, and rental value"

        prompt = f"""
You are GeoAura NZ – an {persona}. Generate a structured LIM-precursor report for a potential {user_type}:

ADDRESS: {address}
COORDINATES: {lat:.6f}, {lng:.6f}

Focus specifically on {focus_area} from the perspective of a {user_type}.

Use ONLY the data provided below. Do not invent, embellish, or make assumptions beyond the data.
If a data section shows no features or an error, explicitly state "No data available" rather than omitting the section.

---
## 1. PROPERTY DATA (LINZ)
{json.dumps(prop_data, indent=2, default=str)}

## 2. FLOOD & COASTAL RISK (NIWA / Waikato RC)
{json.dumps(flood_data, indent=2, default=str)}

## 3. SEISMIC & FAULT LINE RISK (GeoNet / GNS Science)
{json.dumps(seismic_data, indent=2, default=str)}

## 4. CRIME & SAFETY (NZ Police – Feb 2025 to Jan 2026)
{json.dumps(crime_data, indent=2, default=str)}

## 5. MARKET RENT (Tenancy Services MBIE)
{json.dumps(rent_data, indent=2, default=str)}

## 6. TRAFFIC VOLUME (NZTA Waka Kotahi)
{json.dumps(traffic_data, indent=2, default=str)}

---
## 7. RELEVANT NZ BUILDING CODE & DISTRICT PLAN SNIPPETS (RAG)
{rag_context}
---

OUTPUT FORMAT – Return valid JSON only, with exactly this structure:
{{
  "title": "string – Property Intelligence Report: <address>",
  "generated_at": "string – ISO 8601 datetime (UTC)",
  "address": "string",
  "coordinates": {{"lat": number, "lng": number}},
  "executive_summary": "string – 3-4 sentence high-level overview covering the most important findings",
  "sections": [
    {{
      "id": "property",
      "title": "Property & Title",
      "icon": "home_pin",
      "risk_level": "low | medium | high | unknown",
      "content": "string – factual narrative, 3-6 sentences",
      "key_facts": ["string", "string"]
    }},
    {{
      "id": "flood",
      "title": "Flood & Coastal Risk",
      "icon": "water_damage",
      "risk_level": "low | medium | high | unknown",
      "content": "string",
      "key_facts": ["string"]
    }},
    {{
      "id": "seismic",
      "title": "Seismic & Fault Line Risk",
      "icon": "waves",
      "risk_level": "low | medium | high | unknown",
      "content": "string",
      "key_facts": ["string"]
    }},
    {{
      "id": "crime",
      "title": "Safety & Crime Profile",
      "icon": "local_police",
      "risk_level": "low | medium | high | unknown",
      "content": "string",
      "key_facts": ["string"]
    }},
    {{
      "id": "rent",
      "title": "Market Rent & Investment",
      "icon": "real_estate_agent",
      "risk_level": "low | medium | high | unknown",
      "content": "string",
      "key_facts": ["string"]
    }},
    {{
      "id": "traffic",
      "title": "Traffic & Accessibility",
      "icon": "traffic",
      "risk_level": "low | medium | high | unknown",
      "content": "string",
      "key_facts": ["string"]
    }},
    {{
      "id": "regulatory",
      "title": "Regulatory & Building Code",
      "icon": "gavel",
      "risk_level": "low | medium | high | unknown",
      "content": "string – explain how the building code and district plan snippets apply to the specific risks identified (e.g. earthquake or flood mitigation)",
      "key_facts": ["string – reference specific code clauses like E1, B1, etc."]
    }}
  ],
  "overall_risk_rating": "low | medium | high",
  "recommendation": "string – 2-3 sentence overall recommendation specifically tailored for a {user_type}",
  "disclaimer": "This report is generated by AI using publicly available New Zealand datasets. It is provided for informational purposes only and does not constitute professional legal, financial, or property advice. A registered professional LIM report from the relevant local council should be obtained before making any property purchasing decision."
}}
""".strip()

        try:
            response = self._client.models.generate_content(
                model="gemini-3-flash-preview",
                contents=prompt,
                config=genai_types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.2,
                ),
            )
            return json.loads(response.text)
        except json.JSONDecodeError:
            logger.error("Gemini returned non-JSON response")
            return self._fallback_report(address, lat, lng)
        except Exception as exc:
            logger.error("Gemini report synthesis failed: %s", exc)
            raise

    @staticmethod
    def _fallback_report(address: str, lat: float, lng: float) -> dict[str, Any]:
        return {
            "title": f"Property Intelligence Report: {address}",
            "generated_at": "",
            "address": address,
            "coordinates": {"lat": lat, "lng": lng},
            "executive_summary": "Report generation partially failed. Raw data was gathered but synthesis encountered an error.",
            "sections": [],
            "overall_risk_rating": "unknown",
            "recommendation": "Please try again or consult a professional LIM report.",
            "disclaimer": "This report is generated by AI and is for informational purposes only.",
        }
