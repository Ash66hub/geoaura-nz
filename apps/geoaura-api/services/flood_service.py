from typing import Optional

COUNCIL_FLOOD_ENDPOINTS: dict[str, dict] = {
    "Auckland Council": {
        "name": "Auckland Council",
        "type": "raster",
        "wms_url": "https://services6.arcgis.com/cMRSSIKdpklB5JRq/arcgis/rest/services/Flood_Plains/MapServer/tile/{z}/{y}/{x}",
    },
    "Waikato Regional Council": {
        "name": "Waikato Regional Council",
        "feature_service": "https://services.arcgis.com/oI8K3VuW4BkPq3hy/arcgis/rest/services/Waikato_Region_Flood_Hazard/FeatureServer/0",
    },
    "Greater Wellington Regional Council": {
        "name": "Greater Wellington Regional Council",
        "feature_service": "https://maps.gw.govt.nz/portal/rest/services/Hazards/Flood_Hazard_Extents/MapServer/3",
        "geojson_url": "https://maps.gw.govt.nz/portal/rest/services/Hazards/Flood_Hazard_Extents/MapServer/3/query?where=1%3D1&outFields=*&f=geojson&outSR=4326&resultRecordCount=2000"
    },
    "Environment Canterbury": {
        "name": "Environment Canterbury",
        "feature_service": "https://services.arcgis.com/SuDXiGMcCMXBkTQz/arcgis/rest/services/Canterbury_Flood_Hazard/FeatureServer/0",
    },
    "Bay of Plenty Regional Council": {
        "name": "Bay of Plenty Regional Council",
        "feature_service": "https://gis.boprc.govt.nz/server/rest/services/Data/FloodHazard/MapServer/0",
    },
    "Horizons Regional Council": {
        "name": "Horizons Regional Council",
        "feature_service": "https://gismaps.horizons.govt.nz/arcgis/rest/services/Hazards/FloodHazard/MapServer/0",
    },
    "Otago Regional Council": {
        "name": "Otago Regional Council",
        "feature_service": "https://gis.orc.govt.nz/arcgis/rest/services/Hazards/FloodHazard/FeatureServer/0",
    },
    "Northland Regional Council": {
        "name": "Northland Regional Council",
        "feature_service": "https://data.nrc.govt.nz/arcgis/rest/services/Hazards/FloodHazard/FeatureServer/0",
    },
}

# NIWA Henderson & Collins (2018) — confirmed public endpoints from ArcGIS Hub
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
    def get_national_layer_info(self) -> dict:
        base = NIWA_RIVER_NETWORK_URL
        return {
            "source": "NIWA / Henderson & Collins (2018) — NZ River Network REC1",
            "description": "National flood statistics for NZ river segments. Colour-coded by estimated peak flood flow (m³/s).",
            "layers": {
                "flood_plains": {
                    "url": "https://services3.arcgis.com/fp1tibNcN9mbExhG/ArcGIS/rest/services/CoastalFloodLayersARI100/FeatureServer/23",
                    "geojson_url": "https://services3.arcgis.com/fp1tibNcN9mbExhG/ArcGIS/rest/services/CoastalFloodLayersARI100/FeatureServer/23/query?where=SLR%3D0&outFields=REGC2023_V,ARI,SLR&outSR=4326&f=geojson&resultRecordCount=1000",
                    "description": "NIWA 1% AEP (100-year) coastal flood hazard zones — polygon areas of land that flood under current sea levels.",
                },
                "river_network": {
                    "url": NIWA_RIVER_NETWORK_URL,
                    "geojson_url": NIWA_RIVER_NETWORK_URL + "/query?where=1%3D1&orderByFields=Areakm2+DESC&outFields=*&f=geojson&resultRecordCount=5000&outSR=4326",
                },
                "flow_gauges": {
                    "url": NIWA_FLOW_GAUGES_URL,
                    "geojson_url": NIWA_FLOW_GAUGES_URL + "/query?where=1%3D1&outFields=*&f=geojson&outSR=4326",
                },
                "hirds_v3": {
                    "url": NIWA_HIRDS_URL,
                    "geojson_url": NIWA_HIRDS_URL + "/query?where=1%3D1&orderByFields=Areakm2+DESC&outFields=*&f=geojson&resultRecordCount=5000&outSR=4326",
                },
            },
        }

    def get_query_url_with_bbox(self, base_url: str, bbox: list[float], limit: int = 1000) -> str:
        # ArcGIS bbox format: xmin, ymin, xmax, ymax
        # GeoJSON is normally [lng_min, lat_min, lng_max, lat_max]
        bbox_str = f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}"
        return (
            f"{base_url}/query?"
            f"where=1%3D1&"
            f"geometry={bbox_str}&"
            f"geometryType=esriGeometryEnvelope&"
            f"spatialRel=esriSpatialRelIntersects&"
            f"outFields=*&"
            f"f=geojson&"
            f"resultRecordCount={limit}&"
            f"outSR=4326"
        )

    def get_regional_layer_info(self, council_name: str) -> Optional[dict]:
        match = None
        for key, info in COUNCIL_FLOOD_ENDPOINTS.items():
            if key.lower() in council_name.lower() or council_name.lower() in key.lower():
                match = info
                break

        if not match:
            return None

        result = {
            "council": match["name"],
            "type": match.get("type", "geojson"),
        }

        if result["type"] == "raster":
            result["url"] = match["wms_url"]
        else:
            result["url"] = match["feature_service"]
            result["geojson_url"] = match["feature_service"] + "/query?where=1%3D1&outFields=*&f=geojson&resultRecordCount=1000"

        return result
