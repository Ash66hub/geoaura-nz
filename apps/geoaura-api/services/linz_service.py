import os
import httpx
import logging
import asyncio
import time
from typing import Dict, Any, Optional
from models.enums.linz_layers import LINZLayer

logger = logging.getLogger(__name__)

class LINZService:
    def __init__(self):
        self.api_key = os.getenv("LINZ_API_KEY")
        if not self.api_key:
            logger.warning("LINZ_API_KEY is not set in the environment. API calls will fail.")
        
        self.base_url = "https://data.linz.govt.nz/services/query/v1/vector.json"
        self._address_cache: dict[str, tuple[float, list[Dict[str, Any]]]] = {}
        self._address_cache_ttl_seconds = 180.0
        self._address_http_client: Optional[httpx.AsyncClient] = None
        self._address_http_client_loop_id: Optional[int] = None

    def _get_address_http_client(self) -> httpx.AsyncClient:
        """Get a reusable AsyncClient bound to the current event loop."""
        loop_id = id(asyncio.get_running_loop())
        if self._address_http_client is None or self._address_http_client_loop_id != loop_id:
            self._address_http_client = httpx.AsyncClient(
                timeout=httpx.Timeout(connect=1.0, read=2.2, write=2.2, pool=1.0),
                limits=httpx.Limits(max_connections=50, max_keepalive_connections=20),
            )
            self._address_http_client_loop_id = loop_id
        return self._address_http_client

    async def _query_layer(self, layer_id: str, lat: float, lng: float, client: httpx.AsyncClient, radius: str = "10") -> Optional[Dict[str, Any]]:
        params = {
            "key": self.api_key,
            "layer": layer_id,
            "x": str(lng),
            "y": str(lat),
            "srs": "EPSG:4326",
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
            properties = await self._query_layer(
                LINZLayer.PROPERTY_TITLES,
                lat,
                lng,
                client,
                radius="150",
            )
            
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
            property_title = await self._query_layer(
                LINZLayer.PROPERTY_TITLES,
                lat,
                lng,
                client,
                radius="150",
            )
            if property_title:
                return property_title

            return await self._query_layer(
                LINZLayer.PRIMARY_PARCELS,
                lat,
                lng,
                client,
                radius="150",
            )

    async def get_parcel_geometry_by_coords(self, lat: float, lng: float) -> Optional[Dict[str, Any]]:
        """Return the first intersecting property boundary as a GeoJSON Feature."""
        if not self.api_key:
            raise ValueError("LINZ_API_KEY is missing")

        click_point = (lng, lat)

        def normalize_feature(feature: Dict[str, Any]) -> Optional[Dict[str, Any]]:
            geometry = feature.get("geometry")
            properties = feature.get("properties") or {}

            if not geometry:
                return None

            if isinstance(geometry, dict) and geometry.get("type") and geometry.get("coordinates"):
                normalized_geometry = geometry
            elif isinstance(geometry, dict) and geometry.get("rings"):
                normalized_geometry = {
                    "type": "Polygon",
                    "coordinates": geometry.get("rings", []),
                }
            elif isinstance(geometry, dict) and geometry.get("paths"):
                normalized_geometry = {
                    "type": "MultiLineString",
                    "coordinates": geometry.get("paths", []),
                }
            else:
                return None

            return {
                "type": "Feature",
                "geometry": normalized_geometry,
                "properties": properties,
            }

        def ring_contains_point(ring: list[list[float]], point: tuple[float, float]) -> bool:
            if len(ring) < 3:
                return False

            x, y = point
            inside = False
            j = len(ring) - 1

            for i in range(len(ring)):
                xi, yi = ring[i][0], ring[i][1]
                xj, yj = ring[j][0], ring[j][1]
                intersects = ((yi > y) != (yj > y)) and (
                    x < ((xj - xi) * (y - yi)) / ((yj - yi) if (yj - yi) != 0 else 1e-15) + xi
                )
                if intersects:
                    inside = not inside
                j = i

            return inside

        def polygon_contains_point(rings: list[list[list[float]]], point: tuple[float, float]) -> bool:
            if not rings:
                return False

            if not ring_contains_point(rings[0], point):
                return False

            for hole in rings[1:]:
                if ring_contains_point(hole, point):
                    return False

            return True

        def geometry_contains_point(geometry: Dict[str, Any], point: tuple[float, float]) -> bool:
            gtype = geometry.get("type")
            coords = geometry.get("coordinates")

            if gtype == "Polygon" and isinstance(coords, list):
                return polygon_contains_point(coords, point)

            if gtype == "MultiPolygon" and isinstance(coords, list):
                for polygon in coords:
                    if isinstance(polygon, list) and polygon_contains_point(polygon, point):
                        return True

            return False

        def sq_distance_point_to_segment(
            point: tuple[float, float],
            a: tuple[float, float],
            b: tuple[float, float],
        ) -> float:
            px, py = point
            ax, ay = a
            bx, by = b

            abx = bx - ax
            aby = by - ay
            apx = px - ax
            apy = py - ay

            ab_len_sq = abx * abx + aby * aby
            if ab_len_sq == 0:
                dx = px - ax
                dy = py - ay
                return dx * dx + dy * dy

            t = (apx * abx + apy * aby) / ab_len_sq
            if t < 0:
                t = 0
            elif t > 1:
                t = 1

            closest_x = ax + t * abx
            closest_y = ay + t * aby
            dx = px - closest_x
            dy = py - closest_y
            return dx * dx + dy * dy

        def sq_distance_point_to_ring(point: tuple[float, float], ring: list[list[float]]) -> float:
            if len(ring) < 2:
                return float("inf")

            best = float("inf")
            for i in range(len(ring)):
                j = (i + 1) % len(ring)
                va = ring[i]
                vb = ring[j]
                if len(va) < 2 or len(vb) < 2:
                    continue

                score = sq_distance_point_to_segment(
                    point,
                    (float(va[0]), float(va[1])),
                    (float(vb[0]), float(vb[1])),
                )
                if score < best:
                    best = score

            return best

        def sq_distance_point_to_polygon(
            point: tuple[float, float],
            rings: list[list[list[float]]],
        ) -> float:
            if not rings:
                return float("inf")

            best = float("inf")
            for ring in rings:
                score = sq_distance_point_to_ring(point, ring)
                if score < best:
                    best = score

            return best

        def geometry_distance_score(geometry: Dict[str, Any], point: tuple[float, float]) -> float:
            gtype = geometry.get("type")
            coords = geometry.get("coordinates")

            if gtype == "Polygon" and isinstance(coords, list):
                return sq_distance_point_to_polygon(point, coords)

            if gtype == "MultiPolygon" and isinstance(coords, list):
                best = float("inf")
                for polygon in coords:
                    if not isinstance(polygon, list):
                        continue
                    score = sq_distance_point_to_polygon(point, polygon)
                    if score < best:
                        best = score
                return best

            return float("inf")

        def select_best_feature(features: list[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
            normalized_features: list[Dict[str, Any]] = []
            for raw in features:
                if not isinstance(raw, dict):
                    continue
                normalized = normalize_feature(raw)
                if normalized:
                    normalized_features.append(normalized)

            if not normalized_features:
                return None

            containing: list[Dict[str, Any]] = []
            for feature in normalized_features:
                geometry = feature.get("geometry")
                if isinstance(geometry, dict) and geometry_contains_point(geometry, click_point):
                    containing.append(feature)

            pool = containing if containing else normalized_features

            best: Optional[Dict[str, Any]] = None
            best_score = float("inf")
            for feature in pool:
                geometry = feature.get("geometry")
                if not isinstance(geometry, dict):
                    continue
                score = geometry_distance_score(geometry, click_point)
                if score < best_score:
                    best_score = score
                    best = feature

            return best or pool[0]

        async def fetch_wfs_property_feature(client: httpx.AsyncClient) -> Optional[Dict[str, Any]]:
            # Fallback: query LINZ WFS layer-50804 via tiny bbox around clicked point.
            # This path is more reliable than point-radius vector query for some areas.
            wfs_url = f"https://data.linz.govt.nz/services;key={self.api_key}/wfs"
            for delta in (0.00015, 0.0004, 0.0012):
                min_lng = lng - delta
                min_lat = lat - delta
                max_lng = lng + delta
                max_lat = lat + delta
                params = {
                    "service": "WFS",
                    "version": "2.0.0",
                    "request": "GetFeature",
                    "typeNames": "layer-50804",
                    "outputFormat": "application/json",
                    "srsName": "EPSG:4326",
                    "bbox": f"{min_lng},{min_lat},{max_lng},{max_lat},EPSG:4326",
                    "count": "30",
                }
                response = await client.get(wfs_url, params=params)
                response.raise_for_status()
                data = response.json()
                features = data.get("features", []) if isinstance(data, dict) else []
                if not features:
                    continue

                selected = select_best_feature(features)
                if selected:
                    return selected

            return None

        async with httpx.AsyncClient() as client:
            candidate_layers = [LINZLayer.PROPERTY_TITLES, LINZLayer.PRIMARY_PARCELS]
            for radius in (10, 50, 150):
                for layer in candidate_layers:
                    params = {
                        "key": self.api_key,
                        "layer": layer,
                        "x": str(lng),
                        "y": str(lat),
                        "srs": "EPSG:4326",
                        "max_results": "30",
                        "radius": str(radius),
                        "geometry": "true",
                    }

                    response = await client.get(self.base_url, params=params)
                    response.raise_for_status()

                    data = response.json()
                    vector_query = data.get("vectorQuery", {})
                    layers = vector_query.get("layers", {})
                    layer_data = layers.get(layer, {})
                    features = layer_data.get("features", [])
                    if not features:
                        continue

                    selected = select_best_feature(features)
                    if selected:
                        return selected

            wfs_feature = await fetch_wfs_property_feature(client)
            if wfs_feature:
                return wfs_feature

        return None

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
        """Resolve territorial authority (council) from ArcGIS TA polygons."""
        arcgis_url = (
            "https://services.arcgis.com/XTtANUDT8Va4DLwI/arcgis/rest/services/"
            "nz_territorial_authorities/FeatureServer/0/query"
        )

        async with httpx.AsyncClient() as client:
            try:
                params = {
                    "where": "1=1",
                    "geometry": f"{lng},{lat}",
                    "geometryType": "esriGeometryPoint",
                    "inSR": "4326",
                    "spatialRel": "esriSpatialRelIntersects",
                    "outFields": "TA_name,TA_name_ascii,TA_code",
                    "f": "json",
                }
                response = await client.get(arcgis_url, params=params, timeout=20.0)
                response.raise_for_status()
                data = response.json()
                features = data.get("features", [])

                if features:
                    attrs = features[0].get("attributes", {})
                    council_name = attrs.get("TA_name") or attrs.get("TA_name_ascii")
                    if council_name:
                        return {
                            "name": council_name,
                            "council": council_name,
                            "id": attrs.get("TA_code"),
                        }
            except Exception as e:
                logger.warning(f"ArcGIS council lookup failed, falling back to LINZ address lookup: {e}")

            # Fallback to LINZ addresses territorial_authority for edge cases.
            if self.api_key:
                address_data = await self._query_layer(LINZLayer.ADDRESSES, lat, lng, client, radius="500")
                council_name = (address_data or {}).get("territorial_authority")
                if council_name:
                    return {
                        "name": council_name,
                        "council": council_name,
                        "id": None,
                    }

            return None

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
                self._query_layer(LINZLayer.PROPERTY_TITLES, lat, lng, client, radius="150"),
                self._query_layer(LINZLayer.PRIMARY_PARCELS, lat, lng, client, radius="150"),
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

    async def search_addresses(self, query: str, limit: int = 5) -> list[Dict[str, Any]]:
        """Search addresses with GeocodeServer first, FeatureServer as fallback-only."""
        normalized = query.strip()
        if len(normalized) < 2:
            return []

        request_started = time.monotonic()

        cache_key = f"{normalized.lower()}|{limit}"
        cached = self._address_cache.get(cache_key)
        now = time.monotonic()
        if cached and now - cached[0] <= self._address_cache_ttl_seconds:
            return cached[1]

        geocode_url = (
            "https://locate.linz.govt.nz/arcgis/rest/services/GeocodeServer/"
            "findAddressCandidates"
        )
        feature_url = (
            "https://services.arcgis.com/xdsHIIxuCWByZiCB/arcgis/rest/services/"
            "LINZ_NZ_Addresses/FeatureServer/0/query"
        )

        def dedupe_key_for_item(item: Dict[str, Any]) -> str:
            item_id = str(item.get("id") or "")
            if item_id:
                return item_id
            return f"{item.get('label')}|{item.get('lat')}|{item.get('lng')}"

        def normalize_geocode_candidate(candidate: Dict[str, Any], idx: int) -> Optional[Dict[str, Any]]:
            location = candidate.get("location") if isinstance(candidate, dict) else None
            attrs = candidate.get("attributes") if isinstance(candidate, dict) else None

            if not isinstance(location, dict):
                return None

            lng = location.get("x")
            lat = location.get("y")
            if lng is None or lat is None:
                return None

            label = candidate.get("address")
            if not label and isinstance(attrs, dict):
                label = attrs.get("LongLabel") or attrs.get("Match_addr")
            if not label:
                return None

            ta = None
            if isinstance(attrs, dict):
                ta = attrs.get("City") or attrs.get("territorial_authority")

            candidate_id = None
            if isinstance(attrs, dict):
                candidate_id = attrs.get("address_id") or attrs.get("Addr_type")

            return {
                "id": str(candidate_id or f"geo-{idx}"),
                "label": label,
                "lat": float(lat),
                "lng": float(lng),
                "territorial_authority": ta,
            }

        def build_feature_params(where: str) -> dict[str, str]:
            return {
                "where": where,
                "outFields": "address_id,full_address,full_address_number,full_road_name,territorial_authority",
                "returnGeometry": "true",
                "resultRecordCount": str(limit),
                "outSR": "4326",
                "f": "json",
            }

        def normalize_feature(feature: Dict[str, Any], idx: int) -> Optional[Dict[str, Any]]:
            attrs = feature.get("attributes", {})
            geometry = feature.get("geometry", {})
            lng = geometry.get("x")
            lat = geometry.get("y")
            if lng is None or lat is None:
                return None

            label = attrs.get("full_address")
            if not label:
                number = attrs.get("full_address_number") or ""
                road = attrs.get("full_road_name") or ""
                label = f"{number} {road}".strip()
            if not label:
                return None

            return {
                "id": str(attrs.get("address_id") or f"addr-{idx}"),
                "label": label,
                "lat": float(lat),
                "lng": float(lng),
                "territorial_authority": attrs.get("territorial_authority"),
            }

        async def fetch_feature_fallback(
            client: httpx.AsyncClient,
            include_contains: bool = True,
        ) -> list[Dict[str, Any]]:
            escaped = normalized.replace("'", "''")
            where_prefix = (
                f"full_address LIKE '{escaped}%' "
                f"OR full_road_name LIKE '{escaped}%'"
            )
            where_contains = (
                f"full_address LIKE '%{escaped}%' "
                f"OR full_road_name LIKE '%{escaped}%'"
            )

            prefix_result = await client.get(feature_url, params=build_feature_params(where_prefix))
            prefix_result.raise_for_status()
            prefix_payload = prefix_result.json()
            prefix_features = (
                prefix_payload.get("features", []) if isinstance(prefix_payload, dict) else []
            )

            contains_features: list[Dict[str, Any]] = []
            if include_contains and len(normalized) >= 4:
                contains_result = await client.get(feature_url, params=build_feature_params(where_contains))
                contains_result.raise_for_status()
                contains_payload = contains_result.json()
                contains_features = (
                    contains_payload.get("features", []) if isinstance(contains_payload, dict) else []
                )

            suggestions: list[Dict[str, Any]] = []
            seen: set[str] = set()
            for idx, feature in enumerate(prefix_features + contains_features):
                normalized_feature = normalize_feature(feature, idx)
                if not normalized_feature:
                    continue

                key = dedupe_key_for_item(normalized_feature)
                if key in seen:
                    continue

                seen.add(key)
                suggestions.append(normalized_feature)

                if len(suggestions) >= limit:
                    break

            return suggestions

        try:
            client = self._get_address_http_client()

            params = {
                "f": "json",
                "singleLine": normalized,
                "outSR": "4326",
                "maxLocations": str(limit),
                "countryCode": "NZL",
            }

            async def fetch_geocode_suggestions() -> list[Dict[str, Any]]:
                geocode_response = await client.get(geocode_url, params=params)
                geocode_response.raise_for_status()
                geocode_payload = geocode_response.json()

                geocode_candidates = []
                if isinstance(geocode_payload, dict):
                    geocode_candidates = geocode_payload.get("candidates", [])

                geocode_suggestions: list[Dict[str, Any]] = []
                seen_geocode: set[str] = set()
                for idx, candidate in enumerate(geocode_candidates):
                    normalized_candidate = normalize_geocode_candidate(candidate, idx)
                    if not normalized_candidate:
                        continue

                    key = dedupe_key_for_item(normalized_candidate)
                    if key in seen_geocode:
                        continue

                    seen_geocode.add(key)
                    geocode_suggestions.append(normalized_candidate)
                    if len(geocode_suggestions) >= limit:
                        break

                return geocode_suggestions

            geocode_task = asyncio.create_task(fetch_geocode_suggestions())
            prefix_task = asyncio.create_task(fetch_feature_fallback(client, include_contains=False))

            done, pending = await asyncio.wait(
                {geocode_task, prefix_task},
                return_when=asyncio.FIRST_COMPLETED,
            )

            geocode_suggestions: list[Dict[str, Any]] = []
            prefix_suggestions: list[Dict[str, Any]] = []

            for task in done:
                try:
                    result = task.result()
                except Exception as e:
                    logger.warning(f"Address primary source failed: {e}")
                    continue

                if task is geocode_task:
                    geocode_suggestions = result
                else:
                    prefix_suggestions = result

            if geocode_suggestions:
                for task in pending:
                    task.cancel()
                self._address_cache[cache_key] = (now, geocode_suggestions)
                logger.info(
                    "Address search served by GeocodeServer in %.0fms",
                    (time.monotonic() - request_started) * 1000,
                )
                return geocode_suggestions

            if prefix_suggestions:
                for task in pending:
                    task.cancel()
                self._address_cache[cache_key] = (now, prefix_suggestions)
                logger.info(
                    "Address search served by FeatureServer prefix in %.0fms",
                    (time.monotonic() - request_started) * 1000,
                )
                return prefix_suggestions

            if pending:
                more_results = await asyncio.gather(*pending, return_exceptions=True)
                for task, result in zip(pending, more_results):
                    if isinstance(result, Exception):
                        logger.warning(f"Address primary source failed: {result}")
                        continue
                    if task is geocode_task:
                        geocode_suggestions = result
                    else:
                        prefix_suggestions = result

            if geocode_suggestions:
                self._address_cache[cache_key] = (now, geocode_suggestions)
                logger.info(
                    "Address search served by GeocodeServer in %.0fms",
                    (time.monotonic() - request_started) * 1000,
                )
                return geocode_suggestions

            if prefix_suggestions:
                self._address_cache[cache_key] = (now, prefix_suggestions)
                logger.info(
                    "Address search served by FeatureServer prefix in %.0fms",
                    (time.monotonic() - request_started) * 1000,
                )
                return prefix_suggestions

            # Contains matching is slower; run only after fast paths return empty.
            fallback_suggestions = await fetch_feature_fallback(client, include_contains=True)
            self._address_cache[cache_key] = (now, fallback_suggestions)
            logger.info(
                "Address search served by contains fallback in %.0fms",
                (time.monotonic() - request_started) * 1000,
            )
            return fallback_suggestions
        except httpx.HTTPError as e:
            logger.warning(f"GeocodeServer query failed, using fallback: {e}")
            try:
                client = self._get_address_http_client()
                fallback_suggestions = await fetch_feature_fallback(client)
                self._address_cache[cache_key] = (now, fallback_suggestions)
                return fallback_suggestions
            except httpx.HTTPError as fallback_error:
                logger.error(f"Address search fallback failed: {fallback_error}")
                self._address_cache[cache_key] = (now, [])
                return []
            except Exception as fallback_error:
                logger.error(f"Unexpected address search fallback failure: {fallback_error}")
                self._address_cache[cache_key] = (now, [])
                return []
        except Exception as e:
            logger.error(f"Unexpected address search failure: {e}")
            self._address_cache[cache_key] = (now, [])
            return []
