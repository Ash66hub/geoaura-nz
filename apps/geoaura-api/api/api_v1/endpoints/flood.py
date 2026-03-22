from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Query
from services.flood_service import FloodService

router = APIRouter()
flood_service = FloodService()

@router.get("/extent")
def get_flood_data_for_extent(
    min_lng: float = Query(...),
    min_lat: float = Query(...),
    max_lng: float = Query(...),
    max_lat: float = Query(...),
    limit: int = Query(1000, description="Max feature count for polygons/lines")
):
    bbox = [min_lng, min_lat, max_lng, max_lat]
    from services.flood_service import NIWA_FLOW_GAUGES_URL, NIWA_FLOOD_PLAINS_URL, NIWA_RIVER_NETWORK_URL
    response = {
        "plains_url": flood_service.get_query_url_with_bbox(NIWA_FLOOD_PLAINS_URL, bbox, limit=limit),
        "rivers_url": flood_service.get_query_url_with_bbox(NIWA_RIVER_NETWORK_URL, bbox, limit=limit),
        "gauges_url": flood_service.get_query_url_with_bbox(NIWA_FLOW_GAUGES_URL, bbox, limit=1000, extra_params='resultType=standard&quantizationParameters')
    }

    # If bounding box intersects Hamilton region, append Hamilton URL
    if not (max_lng < 174.9 or min_lng > 175.6 or max_lat < -38.2 or min_lat > -37.4):
        hamilton_fs_url = "https://maps.hamilton.govt.nz/server/rest/services/hcc_entpublic/portal_floodviewer_floodhazard/FeatureServer/1"
        response["hamilton_hazard_url"] = flood_service.get_query_url_with_bbox(
            hamilton_fs_url, 
            bbox, 
            limit=50, 
            out_fields="OBJECTID,Hazard_Factor,Storm_Event"
        )

    return response