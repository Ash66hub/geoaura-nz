import os
import httpx
import logging
import json
import urllib.parse
import ssl
import urllib.request
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

class RentService:
    def __init__(self):
        self.api_key = os.getenv("MARKET_RENT_API_KEY")
        self.base_url = "https://api.business.govt.nz/gateway/tenancy-services/market-rent/v2"
        
        if not self.api_key:
            logger.warning("MARKET_RENT_API_KEY is not set in the environment. Rent API calls will fail.")

    async def get_area_definitions(self) -> List[Dict[str, Any]]:
        """Fetch all area definitions from the Market Rent API."""
        if not self.api_key:
            return []
            
        headers = {
            "Ocp-Apim-Subscription-Key": self.api_key,
            "Accept": "application/json"
        }
        
        async with httpx.AsyncClient() as client:
            try:
                target_code = "IMR2017"
                
                # Fetch the items for the target code
                url = f"{self.base_url}/area-definitions/{target_code}"
                response = await client.get(url, headers=headers)
                
                if response.status_code != 200:
                    logger.error(f"MBIE API returned status {response.status_code}: {response.text}")
                    return []
                    
                data = response.json()
                # Check all possible property names
                items = data.get("referenceDataItems") or data.get("items") or data.get("ReferenceDataItems")
                
                if items is None:
                    # If it's a list directly
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
        """Fetch rent statistics for a specific area using IMR2017 definition."""
        if not self.api_key:
            return {}

        if not period_ending:
            target_date = datetime.now() - timedelta(days=60)
            period_ending = target_date.strftime("%Y-%m")

        headers = {
            "Ocp-Apim-Subscription-Key": self.api_key,
            "Accept": "application/json"
        }
        
        is_code = area_id.isdigit()
        
        params = {
            "period-ending": period_ending,
            "num-months": str(num_months),
            "area-definition": "IMR2017"
        }
        
        if is_code:
            params["area-codes"] = area_id
        
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    f"{self.base_url}/statistics", headers=headers, params=params)
                response.raise_for_status()
                data = response.json()
                
                # Normalize any list-like property to 'statistics' for the frontend
                possible_items = data.get("referenceDataItems") or data.get("items") or data.get("ReferenceDataItems")
                if possible_items is not None:
                    data["statistics"] = possible_items
                
                # Map specific field names if the API uses abbreviations or camelCase
                if "statistics" in data:
                    for item in data["statistics"]:
                        if not isinstance(item, dict): continue
                        
                        # Median Rent mapping
                        if "med" in item and "median-rent" not in item:
                            item["median-rent"] = item["med"]
                            
                        # Dwelling Type mapping
                        d_type = item.get("dwelling-type") or item.get("dwell") or item.get("dwellingType") or item.get("DwellingType")
                        if d_type and "dwelling-type" not in item:
                            item["dwelling-type"] = d_type
                            
                        # Bedrooms mapping
                        beds = item.get("num-bedrooms") or item.get("nBedrms") or item.get("numBedrooms") or item.get("NumBedrooms")
                        if beds and "num-bedrooms" not in item:
                            item["num-bedrooms"] = beds
                            
                        # Count mapping
                        count = item.get("count") or item.get("nLodged") or item.get("NLodged") or item.get("nCurr")
                        if count and "count" not in item:
                            item["count"] = count
                            
                return data
            except Exception as e:
                logger.error(f"Error fetching rent statistics for {area_id}: {e}")
                return {}

    async def get_area_definition_by_id(self, area_id: str) -> Dict[str, Any]:
        """Fetch details for a specific area definition."""
        if not self.api_key:
            return {}

        headers = {
            "Ocp-Apim-Subscription-Key": self.api_key,
            "Accept": "application/json"
        }
        
        async with httpx.AsyncClient() as client:
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
        except urllib.error.HTTPError as e:
            error_body = e.read().decode()
            logger.error(f"ArcGIS HTTP Error {e.code}: {e.reason} | Body: {error_body}")
            return {"type": "FeatureCollection", "features": []}
        except Exception as e:
            logger.error(f"Error fetching suburbs from ArcGIS: {e}")
            return {"type": "FeatureCollection", "features": []}
