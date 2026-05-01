import os
import httpx
import asyncio
import logging
import json
import urllib.parse
import ssl
import urllib.request
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

class RentService:
    _client: Optional[httpx.AsyncClient] = None

    def __init__(self):
        load_dotenv()
        # Use Sandbox environment
        self.api_key = os.getenv("MARKET_RENT_SANDBOX_API_KEY") or os.getenv("MARKET_RENT_API_KEY")
        self.base_url = "https://api.business.govt.nz/sandbox/tenancy-services/market-rent/v2"
        
        if not self.api_key:
            logger.warning("No Market Rent API key set in the environment.")

    @classmethod
    async def get_client(cls) -> httpx.AsyncClient:
        """Get a shared, persistent httpx.AsyncClient instance."""
        if cls._client is None or cls._client.is_closed:
            cls._client = httpx.AsyncClient(timeout=60.0)
        return cls._client

    async def get_area_definitions(self) -> List[Dict[str, Any]]:
        """Fetch all area definitions from the Market Rent API."""
        if not self.api_key:
            return []
            
        headers = {
            "Ocp-Apim-Subscription-Key": self.api_key,
            "Accept": "application/json",
            "User-Agent": "GeoAura-NZ-App"
        }
        
        client = await self.get_client()
        try:
            target_code = "IMR2017"
            url = f"{self.base_url}/area-definitions/{target_code}"
            response = await client.get(url, headers=headers)
            
            if response.status_code != 200:
                logger.error(f"MBIE API returned status {response.status_code}: {response.text}")
                return []
                
            data = response.json()
            items = data.get("referenceDataItems") or data.get("items") or data.get("ReferenceDataItems")
            
            if items is None:
                items = data if isinstance(data, list) else []
            
            if not items:
                return []
            
            return [
                {
                    "area-definition": item.get("code") or item.get("id"),
                    "name": item.get("label") or item.get("name")
                }
                for item in items if isinstance(item, dict)
            ]
        except Exception as e:
            logger.error(f"Error fetching area definitions: {e}")
            return []

    async def get_rent_statistics(
        self, 
        area_id: str, 
        period_ending: Optional[str] = None, 
        num_months: int = 6
    ) -> Dict[str, Any]:
        """Fetch rent statistics for a specific area using parallel racing strategy."""
        if not self.api_key:
            return {}

        # Default stable periods to race against (MBIE backend is more stable for older periods)
        # We target periods at least 4-6 months ago as a baseline
        stable_periods = ["2025-10", "2025-08", "2025-06"]
        if period_ending and period_ending not in stable_periods:
            stable_periods.insert(0, period_ending)

        headers = {
            "Ocp-Apim-Subscription-Key": self.api_key,
            "Accept": "application/json",
            "User-Agent": "GeoAura-NZ-App"
        }
        
        is_code = area_id.isdigit()
        client = await self.get_client()

        async def fetch_period(period: str):
            params = {
                "period-ending": period,
                "num-months": str(num_months),
                "area-definition": "IMR2017"
            }
            if is_code:
                params["area-codes"] = area_id
            
            try:
                url = f"{self.base_url}/statistics"
                logger.info(f"Racing fetch for period {period}: {url}")
                response = await client.get(url, headers=headers, params=params)
                if response.status_code == 200:
                    data = response.json()
                    # Normalize and map fields
                    possible_items = data.get("referenceDataItems") or data.get("items") or data.get("ReferenceDataItems")
                    if possible_items is not None:
                        data["statistics"] = possible_items
                    if "statistics" in data:
                        for item in data["statistics"]:
                            if not isinstance(item, dict): continue
                            for old_key, new_key in [("med", "median-rent"), ("dwell", "dwelling-type"), ("nBedrms", "num-bedrooms"), ("nLodged", "count")]:
                                val = item.get(old_key) or item.get(new_key.replace("-", ""))
                                if val and new_key not in item:
                                    item[new_key] = val
                    return data
                return None
            except Exception as e:
                logger.warning(f"Race period {period} failed: {e}")
                return None

        # Run tasks in parallel
        tasks = [fetch_period(p) for p in stable_periods[:3]]
        
        # Return the first successful result
        for coro in asyncio.as_completed(tasks):
            result = await coro
            if result:
                return result

        return {"error": "All raced periods failed or timed out. MBIE API is currently experiencing an outage."}

    async def get_area_definition_by_id(self, area_id: str) -> Dict[str, Any]:
        """Fetch details for a specific area definition."""
        if not self.api_key:
            return {}

        headers = {
            "Ocp-Apim-Subscription-Key": self.api_key,
            "Accept": "application/json",
            "User-Agent": "GeoAura-NZ-App"
        }
        
        client = await self.get_client()
        try:
            response = await client.get(f"{self.base_url}/area-definitions/{area_id}", headers=headers)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Error fetching area definition {area_id}: {e}")
            return {}

    def get_rent_areas_for_extent(
        self,
        min_lng: float,
        min_lat: float,
        max_lng: float,
        max_lat: float,
        limit: int = 500,
    ) -> Dict[str, Any]:
        """Fetch suburb polygons for the current extent from ArcGIS."""
        params = {
            "where": "1=1",
            "geometry": json.dumps({
                "xmin": min_lng,
                "ymin": min_lat,
                "xmax": max_lng,
                "ymax": max_lat,
                "spatialReference": {"wkid": 4326}
            }),
            "geometryType": "esriGeometryEnvelope",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "*",
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "geojson",
            "resultRecordCount": limit,
        }
        url = f"https://services.arcgis.com/xdsHIIxuCWByZiCB/arcgis/rest/services/LINZ_NZ_Suburbs_and_Localities/FeatureServer/0/query?{urllib.parse.urlencode(params)}"

        try:
            context = ssl._create_unverified_context()
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, context=context) as response:
                data = json.loads(response.read().decode())
                return data
        except Exception as e:
            logger.error(f"Error fetching suburbs from ArcGIS: {e}")
            return {"type": "FeatureCollection", "features": []}
