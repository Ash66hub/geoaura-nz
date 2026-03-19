from fastapi import APIRouter, HTTPException, Query
from services.flood_service import FloodService

router = APIRouter()
flood_service = FloodService()

@router.get("/national-layer")
def get_national_flood_layer():
    return flood_service.get_national_layer_info()

@router.get("/extent")
def get_flood_data_for_extent(
    min_lng: float = Query(...),
    min_lat: float = Query(...),
    max_lng: float = Query(...),
    max_lat: float = Query(...)
):
    bbox = [min_lng, min_lat, max_lng, max_lat]
    from services.flood_service import NIWA_RIVER_NETWORK_URL, NIWA_FLOW_GAUGES_URL
    return {
        "rivers_url": flood_service.get_query_url_with_bbox(NIWA_RIVER_NETWORK_URL, bbox, limit=2000),
        "gauges_url": flood_service.get_query_url_with_bbox(NIWA_FLOW_GAUGES_URL, bbox, limit=1000)
    }

@router.get("/regional-layer")
def get_regional_flood_layer(council: str = Query(..., description="Council name from LINZ Territorial Authorities")):
    result = flood_service.get_regional_layer_info(council)
    if not result:
        raise HTTPException(
            status_code=404,
            detail=f"No flood data endpoint registered for council: '{council}'."
        )
    return result
