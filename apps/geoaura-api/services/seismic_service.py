import urllib.parse


class SeismicService:
    def get_earthquakes_query_url_with_bbox(
        self,
        min_lng: float,
        min_lat: float,
        max_lng: float,
        max_lat: float,
        limit: int = 500,
    ) -> str:
        base_url = "https://wfs.geonet.org.nz/geonet/ows"
        cql_filter = f"BBOX(origin_geom,{min_lng},{min_lat},{max_lng},{max_lat}) AND magnitude >= 3"
        cql_encoded = urllib.parse.quote(cql_filter)

        return (
            f"{base_url}?service=WFS&version=1.0.0&request=GetFeature"
            f"&typeName=geonet:quake_search_v1&outputFormat=json"
            f"&cql_filter={cql_encoded}&maxFeatures={limit}"
        )

    # Backwards-compatible alias used by the current API endpoint.
    def get_query_url_with_bbox(
        self,
        min_lng: float,
        min_lat: float,
        max_lng: float,
        max_lat: float,
        limit: int = 500,
    ) -> str:
        return self.get_earthquakes_query_url_with_bbox(min_lng, min_lat, max_lng, max_lat, limit)

    def get_fault_lines_query_url_with_bbox(
        self,
        min_lng: float,
        min_lat: float,
        max_lng: float,
        max_lat: float,
        high_res: bool = False,
        limit: int = 5000,
    ) -> str:
        base_url = "https://gis.gns.cri.nz/server/rest/services/Active_Faults/WebNZActiveFaultsDatasets/MapServer"
        layer_id = 6 if high_res else 0
        params = urllib.parse.urlencode(
            {
                "where": "1=1",
                "geometry": f"{min_lng},{min_lat},{max_lng},{max_lat}",
                "geometryType": "esriGeometryEnvelope",
                "spatialRel": "esriSpatialRelIntersects",
                "inSR": "4326",
                "outSR": "4326",
                "outFields": "*",
                "f": "geojson",
                "resultRecordCount": limit,
            }
        )
        return f"{base_url}/{layer_id}/query?{params}"
