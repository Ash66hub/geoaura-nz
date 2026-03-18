from fastapi import APIRouter, HTTPException, Query
from services.flood_service import FloodService

router = APIRouter()
flood_service = FloodService()

@router.get("/national-layer")
def get_national_flood_layer():
    return flood_service.get_national_layer_info()

@router.get("/regional-layer")
def get_regional_flood_layer(council: str = Query(..., description="Council name from LINZ Territorial Authorities")):
    result = flood_service.get_regional_layer_info(council)
    if not result:
        raise HTTPException(
            status_code=404,
            detail=f"No flood data endpoint registered for council: '{council}'."
        )
    return result
