from fastapi import APIRouter, Query
from services.seismic_service import SeismicService

router = APIRouter()
seismic_service = SeismicService()

@router.get("/extent")
def get_seismic_data_for_extent(
    min_lng: float = Query(...),
    min_lat: float = Query(...),
    max_lng: float = Query(...),
    max_lat: float = Query(...),
    limit: int = Query(500, description="Max feature count for seismic events")
):
    response = {
        "url": seismic_service.get_query_url_with_bbox(min_lng, min_lat, max_lng, max_lat, limit=limit)
    }

    return response
