import os
import httpx
import logging
import asyncio
from typing import Dict, Any, Optional
from models.enums.linz_layers import LINZLayer

logger = logging.getLogger(__name__)

class LINZService:
    def __init__(self):
        self.api_key = os.getenv("LINZ_API_KEY")
        if not self.api_key:
            logger.warning("LINZ_API_KEY is not set in the environment. API calls will fail.")
        
        self.base_url = "https://data.linz.govt.nz/services/query/v1/vector.json"

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
            properties = await self._query_layer(LINZLayer.PROPERTY_TITLES, lat, lng, client)
            
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
            return await self._query_layer(LINZLayer.PRIMARY_PARCELS, lat, lng, client)

    async def get_address_by_coords(self, lat: float, lng: float) -> Optional[Dict[str, Any]]:
        if not self.api_key:
            raise ValueError("LINZ_API_KEY is missing")
        async with httpx.AsyncClient() as client:
            return await self._query_layer(LINZLayer.ADDRESSES, lat, lng, client, radius="50")

    async def get_building_by_coords(self, lat: float, lng: float) -> Optional[Dict[str, Any]]:
        if not self.api_key:
            raise ValueError("LINZ_API_KEY is missing")
        async with httpx.AsyncClient() as client:
            return await self._query_layer(LINZLayer.BUILDING_OUTLINES, lat, lng, client)

    async def get_council_by_coords(self, lat: float, lng: float) -> Optional[Dict[str, Any]]:
        if not self.api_key:
            raise ValueError("LINZ_API_KEY is missing")
        async with httpx.AsyncClient() as client:
            return await self._query_layer(LINZLayer.TERRITORIAL_AUTHORITIES, lat, lng, client)

    async def get_building_details_by_coords(self, lat: float, lng: float) -> Optional[Dict[str, Any]]:
        if not self.api_key:
            raise ValueError("LINZ_API_KEY is missing")
        async with httpx.AsyncClient() as client:
            return await self._query_layer(LINZLayer.BUILDING_DETAILS, lat, lng, client, radius="20")

    async def get_bridge_data_by_coords(self, lat: float, lng: float) -> Optional[Dict[str, Any]]:
        if not self.api_key:
            raise ValueError("LINZ_API_KEY is missing")
        async with httpx.AsyncClient() as client:
            return await self._query_layer(LINZLayer.PROP_BUILDING_BRIDGE, lat, lng, client)

    async def get_all_data_by_coords(self, lat: float, lng: float) -> Optional[Dict[str, Any]]:
        if not self.api_key:
            raise ValueError("LINZ_API_KEY is missing")

        async with httpx.AsyncClient() as client:
            results = await asyncio.gather(
                self._query_layer(LINZLayer.PROPERTY_TITLES, lat, lng, client),
                self._query_layer(LINZLayer.PRIMARY_PARCELS, lat, lng, client),
                self._query_layer(LINZLayer.ADDRESSES, lat, lng, client, radius="50"),
                self._query_layer(LINZLayer.TERRITORIAL_AUTHORITIES, lat, lng, client),
                self._query_layer(LINZLayer.BUILDING_DETAILS, lat, lng, client, radius="20"),
                self._query_layer(LINZLayer.PROP_BUILDING_BRIDGE, lat, lng, client),
                return_exceptions=True
            )
            
            res = [r if not isinstance(r, Exception) else None for r in results]
            
            title_p, parcel_p, address_p, council_p, details_p, bridge_p = res

            if not any(res):
                return None

            title_p, parcel_p, address_p, council_p, details_p, bridge_p = [p or {} for p in res]

            return {
                "title": {
                    "title_no": title_p.get("title_no"),
                    "land_district": title_p.get("land_district")
                },
                "parcel": {
                    "appellation": parcel_p.get("appellation"),
                    "area": title_p.get("title_area") or parcel_p.get("shape_area"),
                    "purpose": parcel_p.get("parcel_intent")
                },
                "address": {
                    "full_address": address_p.get("full_address"),
                    "territorial_authority": address_p.get("territorial_authority")
                },
                "location": {
                    "council": council_p.get("name"),
                    "ta_id": council_p.get("id")
                },
                "building": {
                    "use": details_p.get("use"),
                    "age": details_p.get("age"),
                    "risk_class": details_p.get("predominant_use")
                },
                "bridge": {
                    "building_id": bridge_p.get("building_id"),
                    "property_id": bridge_p.get("property_id")
                }
            }
