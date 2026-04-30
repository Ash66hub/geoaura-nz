from fastapi import APIRouter, HTTPException, Query
from services.rent_service import RentService
from typing import Optional, List, Dict, Any

router = APIRouter()
rent_service = RentService()

@router.get("/area-definitions")
async def get_area_definitions():
    """Get all available area definitions for market rent statistics."""
    try:
        return await rent_service.get_area_definitions()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/statistics")
async def get_rent_statistics(
    area_definition: str = Query(..., description="Area definition ID"),
    period_ending: Optional[str] = Query(None, description="Period ending (YYYY-MM)"),
    num_months: int = Query(6, ge=1, le=24, description="Number of months to aggregate")
):
    """Get market rent statistics for a specific area."""
    try:
        result = await rent_service.get_rent_statistics(area_definition, period_ending, num_months)
        
        if not result:
            raise HTTPException(status_code=404, detail="No statistics found for this area and period.")
            
        if isinstance(result, dict) and "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
            
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/area-definitions/{area_id}")
async def get_area_definition(area_id: str):
    """Get details for a specific area definition."""
    try:
        result = await rent_service.get_area_definition_by_id(area_id)
        if not result:
            raise HTTPException(status_code=404, detail="Area definition not found.")
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/extent")
async def get_rent_extent(
    min_lng: float = Query(..., ge=165.0, le=179.5),
    min_lat: float = Query(..., ge=-48.5, le=-33.0),
    max_lng: float = Query(..., ge=165.0, le=179.5),
    max_lat: float = Query(..., ge=-48.5, le=-33.0),
    limit: int = Query(500, ge=1, le=2000),
):
    """Get suburb polygons for the current map extent."""
    try:
        return rent_service.get_rent_areas_for_extent(
            min_lng=min_lng,
            min_lat=min_lat,
            max_lng=max_lng,
            max_lat=max_lat,
            limit=limit,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
