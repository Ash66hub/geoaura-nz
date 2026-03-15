import os
import httpx
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

class LINZService:
    """
    Service for interacting with the LINZ Data Service APIs.
    Decoupled from FastAPI to allow usage in any context.
    """

    def __init__(self):
        self.api_key = os.getenv("LINZ_API_KEY")
        if not self.api_key:
            logger.warning("LINZ_API_KEY is not set in the environment. API calls will fail.")
        
        self.base_url = "https://data.linz.govt.nz/services/query/v1/vector.json"
        
        # Base Layers
        self.property_layer_id = "50804"   # NZ Property Titles
        self.parcel_layer_id = "51153"     # NZ Primary Parcels
        self.address_layer_id = "105689"   # NZ Addresses
        self.building_layer_id = "101290"  # NZ Building Outlines

    async def _query_layer(self, layer_id: str, lat: float, lng: float, client: httpx.AsyncClient, radius: str = "10") -> Optional[Dict[str, Any]]:
        params = {
            "key": self.api_key,
            "layer": layer_id,
            "x": str(lng),
            "y": str(lat),
            "max_results": "1",
            "radius": radius,
            "geometry": "true"
        }
        
        try:
            response = await client.get(self.base_url, params=params)
            response.raise_for_status()
            
            data = response.json()
            vector_query = data.get("vectorQuery", {})
            layers = vector_query.get("layers", {})
            layer_data = layers.get(layer_id, {})
            features = layer_data.get("features", [])

            if not features:
                return None

            return features[0].get("properties", {})

        except httpx.HTTPError as e:
            logger.error(f"HTTP error occurred querying LINZ layer {layer_id}: {e}")
            raise
        except ValueError as e:
            logger.error(f"Error parsing JSON from LINZ layer {layer_id}: {e}")
            raise
        except Exception as e:
            logger.error(f"Unexpected error in _query_layer for {layer_id}: {e}")
            raise

    async def get_property_by_coords(self, lat: float, lng: float) -> Optional[Dict[str, Any]]:
        if not self.api_key:
            raise ValueError("LINZ_API_KEY is missing")

        async with httpx.AsyncClient() as client:
            properties = await self._query_layer(self.property_layer_id, lat, lng, client)
            
            if not properties:
                logger.info(f"No property found at coords: {lat}, {lng}")
                return None
                
            return {
                "title_no": properties.get("title_no", "Unknown Title"),
                "land_district": properties.get("land_district", "Unknown District")
            }

    async def get_parcel_by_coords(self, lat: float, lng: float) -> Optional[Dict[str, Any]]:
        if not self.api_key:
            raise ValueError("LINZ_API_KEY is missing")
        async with httpx.AsyncClient() as client:
            return await self._query_layer(self.parcel_layer_id, lat, lng, client)

    async def get_address_by_coords(self, lat: float, lng: float) -> Optional[Dict[str, Any]]:
        if not self.api_key:
            raise ValueError("LINZ_API_KEY is missing")
        async with httpx.AsyncClient() as client:
            return await self._query_layer(self.address_layer_id, lat, lng, client, radius="50")

    async def get_building_by_coords(self, lat: float, lng: float) -> Optional[Dict[str, Any]]:
        if not self.api_key:
            raise ValueError("LINZ_API_KEY is missing")
        async with httpx.AsyncClient() as client:
            return await self._query_layer(self.building_layer_id, lat, lng, client)

    async def get_all_data_by_coords(self, lat: float, lng: float) -> Optional[Dict[str, Any]]:
        """
        Fetches all available parcel and title data for a given coordinate.
        Queries Layer 50804 (NZ Property Titles) and Layer 51153 (NZ Primary Parcels).
        """
        if not self.api_key:
            logger.error("LINZ_API_KEY is missing. Cannot perform query.")
            raise ValueError("LINZ_API_KEY is missing")

        async with httpx.AsyncClient() as client:
            title_props = await self._query_layer(self.property_layer_id, lat, lng, client)
            parcel_props = await self._query_layer(self.parcel_layer_id, lat, lng, client)

            if not title_props and not parcel_props:
                return None

            title_props = title_props or {}
            parcel_props = parcel_props or {}

            summary = {
                "title": {
                    "title_no": title_props.get("title_no"),
                    "land_district": title_props.get("land_district"),
                    "issue_date": title_props.get("issue_date"),
                    "guarantee_status": title_props.get("guarantee_status"),
                    "estate_description": title_props.get("estate_description")
                },
                "parcel": {
                    "appellation": parcel_props.get("appellation"),
                    "area": parcel_props.get("shape_area"),
                    "purpose": parcel_props.get("parcel_intent")
                }
            }
            return summary
