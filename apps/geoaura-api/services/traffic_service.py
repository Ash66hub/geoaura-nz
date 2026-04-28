import json
import os
from urllib.parse import quote


TRAFFIC_LINES_URL = os.getenv(
    "TRAFFIC_LINES_URL",
    "https://services.arcgis.com/CXBb7LAjgIIdcsPt/arcgis/rest/services/"
    "AratakiSH_Network_2025_Data_Update/FeatureServer/11",
)

TRAFFIC_HAMILTON_POINTS_URL = os.getenv(
    "TRAFFIC_HAMILTON_POINTS_URL",
    "https://services1.arcgis.com/R6s0QqCMQdwKY6yp/arcgis/rest/services/"
    "Hamilton%20City%20Traffic%20Counts/FeatureServer/0",
)


class TrafficService:
    def get_query_url_with_bbox(
        self,
        base_url: str,
        bbox: list[float],
        limit: int = 5000,
        out_fields: str = "*",
        spatial_rel: str = "esriSpatialRelIntersects",
        extra_params: str = "",
    ) -> str:
        geometry_json = {
            "xmin": bbox[0],
            "ymin": bbox[1],
            "xmax": bbox[2],
            "ymax": bbox[3],
            "spatialReference": {"wkid": 4326},
        }
        geometry_encoded = quote(json.dumps(geometry_json, separators=(",", ":")))
        extra = f"&{extra_params}" if extra_params else ""

        return (
            f"{base_url}/query?"
            f"where=1%3D1&"
            f"geometry={geometry_encoded}&"
            f"geometryType=esriGeometryEnvelope&"
            f"inSR=4326&"
            f"spatialRel={spatial_rel}&"
            f"outFields={out_fields}&"
            f"f=geojson&"
            f"outSR=4326"
            f"{extra}"
        )
