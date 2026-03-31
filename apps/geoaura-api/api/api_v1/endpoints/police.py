from fastapi import APIRouter, HTTPException, Query
from services.police_service import PoliceService

router = APIRouter()
police_service = PoliceService()


@router.get("/incidents")
def get_police_incidents():
    """
    Get police victimisation data aggregated by Meshblock.

    Returns GeoJSON FeatureCollection with:
    - meshblock_code: Meshblock identifier
    - victimisation_sum: Total victimisations in period
    - crime_breakdown: Dict of {ANZSOC Division: count}
    
    Frontend can enrich with:
    - Meshblock geometry from LINZ WFS
    - Population data for rate calculation
    """
    response = police_service.get_police_incidents()
    return response


@router.get("/extent")
def get_police_incidents_for_extent(
    min_lng: float = Query(..., ge=165.0, le=179.5),
    min_lat: float = Query(..., ge=-48.5, le=-33.0),
    max_lng: float = Query(..., ge=165.0, le=179.5),
    max_lat: float = Query(..., ge=-48.5, le=-33.0),
    limit: int = Query(2000, ge=1, le=5000),
):
    """Get police incidents joined with meshblock polygons for current map extent."""
    if min_lng >= max_lng or min_lat >= max_lat:
        raise HTTPException(
            status_code=422,
            detail="Invalid extent bounds. Ensure min coordinates are less than max coordinates.",
        )

    return police_service.get_police_incidents_for_extent(
        min_lng=min_lng,
        min_lat=min_lat,
        max_lng=max_lng,
        max_lat=max_lat,
        limit=limit,
    )
