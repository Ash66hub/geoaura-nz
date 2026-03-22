from typing import Optional


NIWA_FLOOD_PLAINS_URL = (
    "https://services3.arcgis.com/fp1tibNcN9mbExhG/ArcGIS/rest/services/"
    "CoastalFloodLayersARI100/FeatureServer/23"
)

NIWA_RIVER_NETWORK_URL = (
    "https://services3.arcgis.com/fp1tibNcN9mbExhG/arcgis/rest/services/"
    "NZ_Flood_Statistics_Henderson_Collins_V2_REC1_Layer_WFL1/FeatureServer/0"
)

NIWA_FLOW_GAUGES_URL = (
    "https://services3.arcgis.com/fp1tibNcN9mbExhG/arcgis/rest/services/"
    "NZ_Flood_Statistics_Henderson_Collins_V2_FlowGauges_Layer_WFL2/FeatureServer/0"
)

NIWA_HIRDS_URL = (
    "https://services3.arcgis.com/fp1tibNcN9mbExhG/arcgis/rest/services/"
    "NZ_Flood_Statistics_Henderson_Collins_V2_HIRDSV3_REC1_Layer_WFL3/FeatureServer/0"
)


class FloodService:
    def get_query_url_with_bbox(self, base_url: str, bbox: list[float], limit: int = 100, out_fields: str = "*", extra_params: str = "") -> str:
        # ArcGIS bbox format: xmin, ymin, xmax, ymax
        # GeoJSON is normally [lng_min, lat_min, lng_max, lat_max]
        bbox_str = f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}"
        
        # Hamilton API crashes (400/500) if maxAllowableOffset is present or trying to use precise intersection
        is_hamilton = "hamilton.govt.nz" in base_url
        spatial_rel = "esriSpatialRelEnvelopeIntersects" if is_hamilton else "esriSpatialRelIntersects"
        offset_param = "" if is_hamilton else "&maxAllowableOffset=0.0001"

        extra = f"&{extra_params}" if extra_params else ""
        return (
            f"{base_url}/query?"
            f"where=1%3D1&"
            f"geometry={bbox_str}&"
            f"geometryType=esriGeometryEnvelope&"
            f"inSR=4326&"
            f"spatialRel={spatial_rel}&"
            f"outFields={out_fields}&"
            f"f=geojson&"
            f"resultRecordCount={limit}&"
            f"outSR=4326&"
            f"returnGeometry=true"
            f"{offset_param}"
            f"{extra}"
        )

