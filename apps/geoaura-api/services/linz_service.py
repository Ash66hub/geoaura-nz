import os
import httpx
import logging
import asyncio
import time
import math
from typing import Dict, Any, Optional, Union
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

    @staticmethod
    def _coalesce(*values: Any) -> Optional[Any]:
        for value in values:
            if value is None:
                continue
            if isinstance(value, str) and not value.strip():
                continue
            return value
        return None

    @staticmethod
    def _normalize_code(value: Any) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        if not text:
            return None
        return text.upper()

    def map_dvr_property_category(self, dvr_data: Dict[str, Any]) -> Optional[str]:
        raw_code = self._coalesce(
            dvr_data.get("property_category"),
            dvr_data.get("property_category_code"),
            dvr_data.get("use_code"),
        )
        code = self._normalize_code(raw_code)
        if not code:
            return None

        category_map = {
            "RD": "Residential Dwelling",
            "RM": "Residential Multi-unit",
            "RF": "Residential Flat",
            "RS": "Residential Other",
            "CI": "Commercial / Industrial",
            "CO": "Commercial",
            "IN": "Industrial",
            "RU": "Rural",
            "LH": "Lifestyle",
        }
        return category_map.get(code)

    def map_dvr_building_age(self, dvr_data: Dict[str, Any]) -> Optional[str]:
        raw_code = self._coalesce(
            dvr_data.get("building_age_indicator"),
            dvr_data.get("building_age_code"),
            dvr_data.get("age_code"),
        )
        code = self._normalize_code(raw_code)
        if not code:
            return None

        age_map = {
            "188": "1880-1889",
            "189": "1890-1899",
            "190": "1900-1909",
            "191": "1910-1919",
            "192": "1920-1929",
            "193": "1930-1939",
            "194": "1940-1949",
            "195": "1950-1959",
            "196": "1960-1969",
            "197": "1970-1979",
            "198": "1980-1989",
            "199": "1990-1999",
            "200": "2000-2009",
            "201": "2010-2019",
        }
        return age_map.get(code)

    def map_dvr_construction(self, dvr_data: Dict[str, Any]) -> Optional[str]:
        raw_code = self._coalesce(
            dvr_data.get("building_construction_indicator"),
            dvr_data.get("building_construction_code"),
            dvr_data.get("construction_indicator"),
        )
        code = self._normalize_code(raw_code)
        if not code:
            return None

        construction_map = {
            "XI": "Steel or Concrete",
            "FI": "Fibre Cement",
            "BI": "Brick",
        }
        return construction_map.get(code)

    def derive_building_profile(
        self,
        dvr_data: Dict[str, Any],
        building_details_data: Dict[str, Any],
        building_outline_data: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Optional[Any]]:
        dvr_use = self.map_dvr_property_category(dvr_data)
        dvr_age = self.map_dvr_building_age(dvr_data)
        dvr_construction = self.map_dvr_construction(dvr_data)
        outline_use = self._coalesce((building_outline_data or {}).get("use"))
        if isinstance(outline_use, str) and outline_use.strip().lower() == "unknown":
            outline_use = None

        return {
            "use": dvr_use or self._coalesce(building_details_data.get("use"), outline_use),
            "age": dvr_age or self._coalesce(building_details_data.get("age")),
            "risk_class": dvr_construction or self._coalesce(building_details_data.get("predominant_use")),
        }

    @staticmethod
    def _has_valid_area_value(value: Any) -> bool:
        if value is None:
            return False
        if isinstance(value, (int, float)):
            return value > 0
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return False
            if text.lower() in {"unknown", "n/a", "na", "null", "none"}:
                return False
            return True
        return False

    @staticmethod
    def _ring_area_square_meters(ring: list[list[float]], reference_lat: float) -> float:
        if len(ring) < 3:
            return 0.0

        r = 6378137.0
        ref_lat_rad = math.radians(reference_lat)
        cos_ref = math.cos(ref_lat_rad)

        projected: list[tuple[float, float]] = []
        for point in ring:
            if len(point) < 2:
                continue
            lon, lat = float(point[0]), float(point[1])
            x = math.radians(lon) * r * cos_ref
            y = math.radians(lat) * r
            projected.append((x, y))

        if len(projected) < 3:
            return 0.0

        area = 0.0
        j = len(projected) - 1
        for i in range(len(projected)):
            xi, yi = projected[i]
            xj, yj = projected[j]
            area += (xj + xi) * (yj - yi)
            j = i

        return abs(area) * 0.5

    def _estimate_polygon_area_square_meters(
        self,
        geometry: Optional[Dict[str, Any]],
    ) -> Optional[float]:
        if not isinstance(geometry, dict):
            return None

        gtype = geometry.get("type")
        coords = geometry.get("coordinates")
        if not isinstance(coords, list):
            return None

        def polygon_area(polygon: list[list[list[float]]]) -> float:
            if not polygon or not isinstance(polygon[0], list):
                return 0.0

            outer_ring = polygon[0]
            if not outer_ring:
                return 0.0

            lat_samples = [float(p[1]) for p in outer_ring if isinstance(p, list) and len(p) >= 2]
            if not lat_samples:
                return 0.0
            reference_lat = sum(lat_samples) / len(lat_samples)

            area = self._ring_area_square_meters(outer_ring, reference_lat)
            for hole in polygon[1:]:
                if isinstance(hole, list):
                    area -= self._ring_area_square_meters(hole, reference_lat)
            return max(area, 0.0)

        if gtype == "Polygon":
            area = polygon_area(coords)
            return area if area > 0 else None

        if gtype == "MultiPolygon":
            total = 0.0
            for polygon in coords:
                if isinstance(polygon, list):
                    total += polygon_area(polygon)
            return total if total > 0 else None

        return None

    @staticmethod
    def _layer_value(layer_id: Union[str, LINZLayer]) -> str:
        if isinstance(layer_id, LINZLayer):
            return layer_id.value
        return str(layer_id)

    async def _query_layer(self, layer_id: Union[str, LINZLayer], lat: float, lng: float, client: httpx.AsyncClient, radius: str = "10") -> Optional[Dict[str, Any]]:
        layer_value = self._layer_value(layer_id)
        params = {
            "key": self.api_key,
            "layer": layer_value,
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
            layer_data = layers.get(layer_value, {})
            features = layer_data.get("features", [])

            if not features:
                logger.debug(f"No features found for layer {layer_value} at ({lat}, {lng}) with radius {radius}m")
                return None

            result = features[0].get("properties", {})
            logger.debug(f"Found feature for layer {layer_value}: {list(result.keys())}")
            return result

        except httpx.HTTPError as e:
            logger.error(f"HTTP error occurred querying LINZ layer {layer_value} at ({lat}, {lng}): {e}")
            raise
        except ValueError as e:
            logger.error(f"Error parsing JSON from LINZ layer {layer_value}: {e}")
            raise
        except Exception as e:
            logger.error(f"Unexpected error in _query_layer for {layer_value} at ({lat}, {lng}): {e}")
            raise

    async def _query_layer_cql(
        self,
        layer_id: Union[str, LINZLayer],
        cql_filter: str,
        client: httpx.AsyncClient,
        max_results: int = 10,
        geometry: bool = True,
    ) -> list[Dict[str, Any]]:
        layer_value = self._layer_value(layer_id)
        params = {
            "key": self.api_key,
            "layer": layer_value,
            "srs": "EPSG:4326",
            "max_results": str(max_results),
            "geometry": "true" if geometry else "false",
            "cql_filter": cql_filter,
        }

        response = await client.get(self.base_url, params=params)
        response.raise_for_status()

        payload = response.json() if response.text else {}
        vector_query = payload.get("vectorQuery", {}) if isinstance(payload, dict) else {}
        layers = vector_query.get("layers", {}) if isinstance(vector_query, dict) else {}
        layer_data = layers.get(layer_value, {}) if isinstance(layers, dict) else {}
        features = layer_data.get("features", []) if isinstance(layer_data, dict) else []
        if isinstance(features, list):
            return [f for f in features if isinstance(f, dict)]
        return []

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
                radius="200",
            )
            if property_title:
                return property_title

            current_parcel = await self._query_layer(
                LINZLayer.PRIMARY_PARCELS_CURRENT,
                lat,
                lng,
                client,
                radius="200",
            )
            if current_parcel:
                return current_parcel

            return await self._query_layer(
                LINZLayer.PRIMARY_PARCELS,
                lat,
                lng,
                client,
                radius="200",
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
            candidate_layers = [
                LINZLayer.PROPERTY_TITLES,
                LINZLayer.PRIMARY_PARCELS_CURRENT,
                LINZLayer.PRIMARY_PARCELS,
            ]
            for radius in (10, 50, 150):
                for layer in candidate_layers:
                    layer_value = self._layer_value(layer)
                    params = {
                        "key": self.api_key,
                        "layer": layer_value,
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
                    layer_data = layers.get(layer_value, {})
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
            return await self._query_layer(LINZLayer.ADDRESSES, lat, lng, client, radius="100")

    async def get_building_by_coords(self, lat: float, lng: float) -> Optional[Dict[str, Any]]:
        if not self.api_key:
            raise ValueError("LINZ_API_KEY is missing")
        async with httpx.AsyncClient() as client:
            return await self._query_layer(LINZLayer.BUILDING_OUTLINES, lat, lng, client, radius="50")

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
            return await self._query_layer(LINZLayer.BUILDING_DETAILS, lat, lng, client, radius="50")

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
                self._query_layer(LINZLayer.PROPERTY_TITLES, lat, lng, client, radius="200"),
                self._query_layer(LINZLayer.PRIMARY_PARCELS_CURRENT, lat, lng, client, radius="200"),
                self._query_layer(LINZLayer.PRIMARY_PARCELS, lat, lng, client, radius="200"),
                self._query_layer(LINZLayer.ADDRESSES, lat, lng, client, radius="100"),
                self._query_layer(LINZLayer.TERRITORIAL_AUTHORITIES, lat, lng, client, radius="500"),
                self._query_layer(LINZLayer.DISTRICT_VALUATION_ROLL, lat, lng, client, radius="300"),
                self._query_layer(LINZLayer.BUILDING_DETAILS, lat, lng, client, radius="50"),
                self._query_layer(LINZLayer.BUILDING_OUTLINES, lat, lng, client, radius="50"),
                self._query_layer(LINZLayer.PROP_BUILDING_BRIDGE, lat, lng, client, radius="200"),
                return_exceptions=True,
            )

            res = [r if not isinstance(r, Exception) else None for r in results]
            title_p, parcel_current_p, parcel_legacy_p, address_p, council_p, dvr_p, details_p, outlines_p, bridge_p = res

            if not any(res):
                return None

            title_p = title_p or {}
            parcel_p = (parcel_current_p or parcel_legacy_p or {})
            address_p = address_p or {}
            council_p = council_p or {}
            dvr_p = dvr_p or {}
            details_p = details_p or {}
            outlines_p = outlines_p or {}
            bridge_p = bridge_p or {}

            # LINZ TA layer fields are not always aligned with the API's name/id shape.
            # Fall back to ArcGIS TA lookup to keep council fields populated in summary responses.
            if not (council_p.get("name") or council_p.get("council")):
                resolved_council = await self.get_council_by_coords(lat, lng)
                if resolved_council:
                    council_p = resolved_council

            improvements_value_raw = dvr_p.get("improvements_value")
            try:
                improvements_value = float(improvements_value_raw) if improvements_value_raw is not None else None
            except (TypeError, ValueError):
                improvements_value = None

            has_improvements = None
            if improvements_value is not None:
                has_improvements = improvements_value > 0

            building_profile = self.derive_building_profile(dvr_p, details_p, outlines_p)

            parcel_area = title_p.get("title_area") or parcel_p.get("shape_area")
            if not self._has_valid_area_value(parcel_area):
                parcel_feature = await self.get_parcel_geometry_by_coords(lat, lng)
                approx_area = self._estimate_polygon_area_square_meters(
                    parcel_feature.get("geometry") if isinstance(parcel_feature, dict) else None
                )
                if approx_area is not None:
                    parcel_area = f"~{int(round(approx_area))} m2"

            title_numbers: list[str] = []
            title_no = title_p.get("title_no")
            if isinstance(title_no, str) and title_no.strip():
                title_numbers.append(title_no.strip())

            parcel_identifier = parcel_p.get("parcel_id") or parcel_p.get("id")
            if parcel_identifier is not None:
                escaped_parcel_id = str(parcel_identifier).replace("'", "''")
                cql = f"parcel_id = '{escaped_parcel_id}'"
                if escaped_parcel_id.isdigit():
                    cql = f"parcel_id = {escaped_parcel_id} OR parcel_id = '{escaped_parcel_id}'"
                try:
                    assoc_rows = await self._query_layer_cql(
                        LINZLayer.PARCEL_TITLE_ASSOCIATION,
                        cql,
                        client,
                        max_results=25,
                        geometry=False,
                    )
                    for row in assoc_rows:
                        props = row.get("properties", {}) if isinstance(row, dict) else {}
                        assoc_title = (
                            props.get("title_no")
                            or props.get("title_number")
                            or props.get("title_reference")
                        )
                        if isinstance(assoc_title, str):
                            clean_title = assoc_title.strip()
                            if clean_title and clean_title not in title_numbers:
                                title_numbers.append(clean_title)
                except Exception:
                    # Association lookups are best-effort and should not fail the summary path.
                    pass

            return {
                "title": {
                    "title_no": title_no,
                    "title_numbers": title_numbers,
                    "land_district": title_p.get("land_district"),
                    "type": title_p.get("type"),
                },
                "parcel": {
                    "appellation": parcel_p.get("appellation"),
                    "area": parcel_area,
                    "purpose": parcel_p.get("parcel_intent"),
                },
                "address": {
                    "full_address": address_p.get("full_address"),
                    "territorial_authority": address_p.get("territorial_authority"),
                },
                "location": {
                    "council": council_p.get("name") or council_p.get("council"),
                    "ta_id": council_p.get("id"),
                },
                "building": {
                    "use": building_profile.get("use"),
                    "age": building_profile.get("age"),
                    "risk_class": building_profile.get("risk_class"),
                    "improvements_value": improvements_value,
                    "has_improvements": has_improvements,
                },
                "bridge": {
                    "building_id": bridge_p.get("building_id") or outlines_p.get("building_id"),
                    "property_id": bridge_p.get("property_id"),
                },
            }

    async def search_addresses(self, query: str, limit: int = 5) -> list[Dict[str, Any]]:
        """Search addresses via LINZ Vector Query first, geocoder as fallback."""
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

        def normalize_vector_feature(feature: Dict[str, Any], idx: int) -> Optional[Dict[str, Any]]:
            props = feature.get("properties", {}) if isinstance(feature, dict) else {}
            geometry = feature.get("geometry", {}) if isinstance(feature, dict) else {}

            lat = None
            lng = None
            if isinstance(geometry, dict):
                if geometry.get("type") == "Point":
                    coordinates = geometry.get("coordinates")
                    if isinstance(coordinates, list) and len(coordinates) >= 2:
                        lng = coordinates[0]
                        lat = coordinates[1]
                if lat is None or lng is None:
                    # Defensive fallback for non-GeoJSON point responses.
                    lng = geometry.get("x", lng)
                    lat = geometry.get("y", lat)

            if lat is None or lng is None:
                return None

            label = props.get("full_address")
            if not label:
                number = props.get("full_address_number") or ""
                road = props.get("full_road_name") or ""
                label = f"{number} {road}".strip()
            if not label:
                return None

            return {
                "id": str(props.get("address_id") or f"addr-{idx}"),
                "label": label,
                "lat": float(lat),
                "lng": float(lng),
                "territorial_authority": props.get("territorial_authority"),
            }

        async def fetch_vector_suggestions(include_contains: bool) -> list[Dict[str, Any]]:
            escaped = normalized.replace("'", "''")
            cql_prefix = (
                f"full_address ILIKE '{escaped}%' "
                f"OR full_road_name ILIKE '{escaped}%'"
            )
            cql_contains = (
                f"full_address ILIKE '%{escaped}%' "
                f"OR full_road_name ILIKE '%{escaped}%'"
            )

            client = self._get_address_http_client()
            prefix_features = await self._query_layer_cql(
                LINZLayer.ADDRESSES,
                cql_prefix,
                client,
                max_results=limit,
                geometry=True,
            )

            contains_features: list[Dict[str, Any]] = []
            if include_contains and len(normalized) >= 4:
                contains_features = await self._query_layer_cql(
                    LINZLayer.ADDRESSES,
                    cql_contains,
                    client,
                    max_results=limit,
                    geometry=True,
                )

            suggestions: list[Dict[str, Any]] = []
            seen: set[str] = set()
            for idx, feature in enumerate(prefix_features + contains_features):
                item = normalize_vector_feature(feature, idx)
                if not item:
                    continue
                key = dedupe_key_for_item(item)
                if key in seen:
                    continue
                seen.add(key)
                suggestions.append(item)
                if len(suggestions) >= limit:
                    break

            return suggestions

        def build_feature_params(where: str) -> dict[str, str]:
            return {
                "where": where,
                "outFields": "address_id,full_address,full_address_number,full_road_name,territorial_authority",
                "returnGeometry": "true",
                "resultRecordCount": str(limit),
                "outSR": "4326",
                "f": "json",
            }

        def normalize_feature_server_feature(feature: Dict[str, Any], idx: int) -> Optional[Dict[str, Any]]:
            attrs = feature.get("attributes", {}) if isinstance(feature, dict) else {}
            geometry = feature.get("geometry", {}) if isinstance(feature, dict) else {}
            lng = geometry.get("x") if isinstance(geometry, dict) else None
            lat = geometry.get("y") if isinstance(geometry, dict) else None
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
                "id": str(attrs.get("address_id") or f"fs-{idx}"),
                "label": label,
                "lat": float(lat),
                "lng": float(lng),
                "territorial_authority": attrs.get("territorial_authority"),
            }

        async def fetch_feature_server_suggestions(include_contains: bool) -> list[Dict[str, Any]]:
            escaped = normalized.replace("'", "''")
            where_prefix = (
                f"full_address LIKE '{escaped}%' "
                f"OR full_road_name LIKE '{escaped}%'"
            )
            where_contains = (
                f"full_address LIKE '%{escaped}%' "
                f"OR full_road_name LIKE '%{escaped}%'"
            )

            client = self._get_address_http_client()
            prefix_response = await client.get(feature_url, params=build_feature_params(where_prefix))
            prefix_response.raise_for_status()
            prefix_payload = prefix_response.json() if prefix_response.text else {}
            prefix_features = prefix_payload.get("features", []) if isinstance(prefix_payload, dict) else []

            contains_features: list[Dict[str, Any]] = []
            if include_contains and len(normalized) >= 4:
                contains_response = await client.get(feature_url, params=build_feature_params(where_contains))
                contains_response.raise_for_status()
                contains_payload = contains_response.json() if contains_response.text else {}
                contains_features = contains_payload.get("features", []) if isinstance(contains_payload, dict) else []

            results: list[Dict[str, Any]] = []
            seen: set[str] = set()
            for idx, feature in enumerate(prefix_features + contains_features):
                item = normalize_feature_server_feature(feature, idx)
                if not item:
                    continue
                key = dedupe_key_for_item(item)
                if key in seen:
                    continue
                seen.add(key)
                results.append(item)
                if len(results) >= limit:
                    break

            return results

        async def fetch_geocode_suggestions() -> list[Dict[str, Any]]:
            client = self._get_address_http_client()
            params = {
                "f": "json",
                "singleLine": normalized,
                "outSR": "4326",
                "maxLocations": str(limit),
                "countryCode": "NZL",
            }

            response = await client.get(geocode_url, params=params)
            response.raise_for_status()
            payload = response.json() if response.text else {}
            candidates = payload.get("candidates", []) if isinstance(payload, dict) else []

            results: list[Dict[str, Any]] = []
            seen: set[str] = set()
            for idx, candidate in enumerate(candidates):
                location = candidate.get("location") if isinstance(candidate, dict) else None
                if not isinstance(location, dict):
                    continue

                lng = location.get("x")
                lat = location.get("y")
                if lng is None or lat is None:
                    continue

                attrs = candidate.get("attributes") if isinstance(candidate, dict) else {}
                label = candidate.get("address") or (attrs.get("LongLabel") if isinstance(attrs, dict) else None)
                if not label:
                    continue

                item = {
                    "id": str((attrs or {}).get("address_id") or f"geo-{idx}"),
                    "label": label,
                    "lat": float(lat),
                    "lng": float(lng),
                    "territorial_authority": (attrs or {}).get("City") if isinstance(attrs, dict) else None,
                }
                key = dedupe_key_for_item(item)
                if key in seen:
                    continue
                seen.add(key)
                results.append(item)
                if len(results) >= limit:
                    break

            return results

        try:
            vector_prefix = await fetch_vector_suggestions(include_contains=False)
            if vector_prefix:
                self._address_cache[cache_key] = (now, vector_prefix)
                logger.info(
                    "Address search served by LINZ vector prefix in %.0fms",
                    (time.monotonic() - request_started) * 1000,
                )
                return vector_prefix

            vector_contains = await fetch_vector_suggestions(include_contains=True)
            if vector_contains:
                self._address_cache[cache_key] = (now, vector_contains)
                logger.info(
                    "Address search served by LINZ vector contains in %.0fms",
                    (time.monotonic() - request_started) * 1000,
                )
                return vector_contains

            feature_prefix = await fetch_feature_server_suggestions(include_contains=False)
            if feature_prefix:
                self._address_cache[cache_key] = (now, feature_prefix)
                logger.info(
                    "Address search served by FeatureServer prefix in %.0fms",
                    (time.monotonic() - request_started) * 1000,
                )
                return feature_prefix

            feature_contains = await fetch_feature_server_suggestions(include_contains=True)
            if feature_contains:
                self._address_cache[cache_key] = (now, feature_contains)
                logger.info(
                    "Address search served by FeatureServer contains in %.0fms",
                    (time.monotonic() - request_started) * 1000,
                )
                return feature_contains

            geocode_fallback = await fetch_geocode_suggestions()
            self._address_cache[cache_key] = (now, geocode_fallback)
            logger.info(
                "Address search served by geocoder fallback in %.0fms",
                (time.monotonic() - request_started) * 1000,
            )
            return geocode_fallback
        except httpx.HTTPError as e:
            logger.warning(f"Address search primary query failed: {e}")
            try:
                feature_fallback = await fetch_feature_server_suggestions(include_contains=True)
                if feature_fallback:
                    self._address_cache[cache_key] = (now, feature_fallback)
                    return feature_fallback
                geocode_fallback = await fetch_geocode_suggestions()
                self._address_cache[cache_key] = (now, geocode_fallback)
                return geocode_fallback
            except Exception as fallback_error:
                logger.error(f"Address search fallback failed: {fallback_error}")
                self._address_cache[cache_key] = (now, [])
                return []
        except Exception as e:
            logger.error(f"Unexpected address search failure: {e}")
            self._address_cache[cache_key] = (now, [])
            return []
