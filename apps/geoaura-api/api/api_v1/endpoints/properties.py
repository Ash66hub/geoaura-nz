from fastapi import APIRouter, HTTPException, Query
from services.linz_service import LINZService

router = APIRouter()
linz_service = LINZService()

@router.get("/title")
async def get_property_title(
    lat: float = Query(..., description="Latitude of the property (WGS84)"),
    lng: float = Query(..., description="Longitude of the property (WGS84)")
):
    """
    Fetch the title and land district for a property via the LINZ API.
    """
    try:
        result = await linz_service.get_property_by_coords(lat, lng)
        if not result:
            raise HTTPException(status_code=404, detail="No property found at these coordinates.")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/summary")
async def get_property_summary(
    lat: float = Query(..., description="Latitude of the property (WGS84)"),
    lng: float = Query(..., description="Longitude of the property (WGS84)")
):
    """
    Fetch all available detailed data (Title + Parcel geometry info) for a coordinate.
    """
    try:
        result = await linz_service.get_all_data_by_coords(lat, lng)
        if not result:
            raise HTTPException(status_code=404, detail="No parcel data found at these coordinates.")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/parcel")
async def get_parcel(
    lat: float = Query(..., description="Latitude of the property (WGS84)"),
    lng: float = Query(..., description="Longitude of the property (WGS84)")
):
    """
    Fetch the primary parcel data for a coordinate via the LINZ API.
    """
    try:
        result = await linz_service.get_parcel_by_coords(lat, lng)
        if not result:
            raise HTTPException(status_code=404, detail="No parcel found at these coordinates.")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/address")
async def get_address(
    lat: float = Query(..., description="Latitude of the property (WGS84)"),
    lng: float = Query(..., description="Longitude of the property (WGS84)")
):
    """
    Fetch the physical address data for a coordinate via the LINZ API.
    """
    try:
        result = await linz_service.get_address_by_coords(lat, lng)
        if not result:
            raise HTTPException(status_code=404, detail="No address found at these coordinates.")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/building")
async def get_building(
    lat: float = Query(..., description="Latitude of the property (WGS84)"),
    lng: float = Query(..., description="Longitude of the property (WGS84)")
):
    """
    Fetch the building outline data for a coordinate via the LINZ API.
    """
    try:
        result = await linz_service.get_building_by_coords(lat, lng)
        if not result:
            raise HTTPException(status_code=404, detail="No building found at these coordinates.")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")
