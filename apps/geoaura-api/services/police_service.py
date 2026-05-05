import json
import ssl
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional


class PoliceService:
    """Aggregate NZ Police victimisation data for meshblock-level analytics."""

    _CACHE_TTL_SECONDS = 3600.0

    MESHBLOCK_2025_QUERY_URL = (
        "https://services2.arcgis.com/vKb0s8tBIA3bdocZ/arcgis/rest/services/"
        "Meshblock_2025/FeatureServer/0/query"
    )

    def __init__(self):
        # path to apps/geoaura-api/data/police_aggregated.json
        self.json_path = (
            Path(__file__).resolve().parent.parent
            / "data"
            / "police_aggregated.json"
        )

        self._aggregated_cache: dict[str, dict[str, int]] | None = None
        self._population_cache: dict[str, float] | None = None

    def _ensure_cache(self) -> None:
        if self._aggregated_cache is not None and self._population_cache is not None:
            return

        if not self.json_path.exists():
            # Fallback to empty if json not found (should be committed or fetched)
            self._aggregated_cache = {}
            self._population_cache = {}
            return

        try:
            data = json.loads(self.json_path.read_bytes())
            self._aggregated_cache = data.get("crime", {})
            self._population_cache = data.get("population", {})
        except Exception as e:
            print(f"Error loading police_aggregated.json: {e}")
            self._aggregated_cache = {}
            self._population_cache = {}

    def get_aggregated_data(self) -> dict[str, dict[str, int]]:
        self._ensure_cache()
        return self._aggregated_cache  # type: ignore[return-value]

    def get_population_data(self) -> dict[str, float]:
        self._ensure_cache()
        return self._population_cache  # type: ignore[return-value]

    @staticmethod
    def _normalize_meshblock_code(code: str) -> str:
        normalized = code.strip()
        if not normalized:
            return normalized
        return normalized.lstrip("0") or "0"

    def _fetch_meshblocks_for_extent(
        self,
        min_lng: float,
        min_lat: float,
        max_lng: float,
        max_lat: float,
        limit: int,
    ) -> dict[str, Any]:
        params = {
            "where": "1=1",
            "geometry": f"{min_lng},{min_lat},{max_lng},{max_lat}",
            "geometryType": "esriGeometryEnvelope",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "*",
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "geojson",
            "resultRecordCount": str(limit),
        }
        url = f"{self.MESHBLOCK_2025_QUERY_URL}?{urllib.parse.urlencode(params)}"
        context = ssl._create_unverified_context()
        with urllib.request.urlopen(url, timeout=40, context=context) as response:
            return json.loads(response.read().decode("utf-8"))

    def get_police_incidents_for_extent(
        self,
        min_lng: float,
        min_lat: float,
        max_lng: float,
        max_lat: float,
        limit: int = 2000,
    ) -> dict[str, Any]:
        self._ensure_cache()
        aggregated_data = self._aggregated_cache
        population_data = self._population_cache

        meshblocks_geojson = self._fetch_meshblocks_for_extent(
            min_lng=min_lng,
            min_lat=min_lat,
            max_lng=max_lng,
            max_lat=max_lat,
            limit=limit,
        )

        features: list[dict[str, Any]] = []
        for feature in meshblocks_geojson.get("features", []):
            props = feature.get("properties", {}) or {}
            raw_code = str(props.get("MB2025_V2_00") or props.get("MB2025_V1_00", "")).strip()
            normalized_code = self._normalize_meshblock_code(raw_code)
            if not normalized_code:
                continue

            crime_breakdown = aggregated_data.get(normalized_code)  # type: ignore[union-attr]
            if not crime_breakdown:
                continue

            total_victimisations = sum(crime_breakdown.values())
            land_area = props.get("LAND_AREA_SQ_KM")
            density = None
            population_estimate = population_data.get(normalized_code)  # type: ignore[union-attr]
            population_adjusted_rate = None

            try:
                land_area_val = float(land_area)
                if land_area_val > 0:
                    density = total_victimisations / land_area_val
            except (TypeError, ValueError):
                density = None

            if population_estimate and population_estimate > 0:
                population_adjusted_rate = (total_victimisations / population_estimate) * 1000

            features.append(
                {
                    "type": "Feature",
                    "id": normalized_code,
                    "geometry": feature.get("geometry"),
                    "properties": {
                        "meshblock_code": normalized_code,
                        "meshblock_code_padded": raw_code,
                        "victimisation_sum": total_victimisations,
                        "victimisation_rate": density,
                        "victimisation_rate_population": population_adjusted_rate,
                        "population_estimate": population_estimate,
                        "land_area_sq_km": land_area,
                        "crime_breakdown": crime_breakdown,
                    },
                }
            )

        return {
            "type": "FeatureCollection",
            "features": features,
            "properties": {
                "data_source": "NZ Police + Stats NZ Meshblock 2025",
                "time_period": "February 2025 - January 2026",
                "aggregation_level": "Meshblock",
                "aggregate_type": "victimisations",
            },
        }
