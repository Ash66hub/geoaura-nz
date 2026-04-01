from fastapi import APIRouter, Query
from services.traffic_service import (
    TRAFFIC_HAMILTON_POINTS_URL,
    TRAFFIC_LINES_URL,
    TrafficService,
)

router = APIRouter()
traffic_service = TrafficService()


@router.get("/extent")
def get_traffic_data_for_extent(
    min_lng: float = Query(...),
    min_lat: float = Query(...),
    max_lng: float = Query(...),
    max_lat: float = Query(...),
    limit: int = Query(5000, description="Max feature count for traffic lines"),
):
    bbox = [min_lng, min_lat, max_lng, max_lat]
    response = {
        "traffic_url": traffic_service.get_query_url_with_bbox(
            TRAFFIC_LINES_URL,
            bbox,
            limit=limit,
        ),
        "traffic_lines_url": traffic_service.get_query_url_with_bbox(
            TRAFFIC_LINES_URL,
            bbox,
            limit=limit,
        ),
    }

    # Only request Hamilton City traffic points when the viewport intersects Hamilton.
    if not (max_lng < 174.9 or min_lng > 175.6 or max_lat < -38.2 or min_lat > -37.4):
        response["traffic_points_url"] = traffic_service.get_query_url_with_bbox(
            TRAFFIC_HAMILTON_POINTS_URL,
            bbox,
            limit=limit,
        )

    return response
