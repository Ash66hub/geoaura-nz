import urllib.parse

class SeismicService:
    def get_query_url_with_bbox(self, min_lng: float, min_lat: float, max_lng: float, max_lat: float, limit: int = 500) -> str:
        base_url = "https://wfs.geonet.org.nz/geonet/ows"
        # BBOX in CQL is usually PropertyName, minX, minY, maxX, maxY
        # The geometry field for quake_search_v1 is 'origin_geom'
        
        cql_filter = f"BBOX(origin_geom,{min_lng},{min_lat},{max_lng},{max_lat}) AND magnitude >= 3"
        cql_encoded = urllib.parse.quote(cql_filter)

        return (
            f"{base_url}?service=WFS&version=1.0.0&request=GetFeature"
            f"&typeName=geonet:quake_search_v1&outputFormat=json"
            f"&cql_filter={cql_encoded}&maxFeatures={limit}"
        )
