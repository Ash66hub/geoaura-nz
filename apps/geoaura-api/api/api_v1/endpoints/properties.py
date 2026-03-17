from fastapi import APIRouter, HTTPException, Query
from services.linz_service import LINZService

router = APIRouter()
linz_service = LINZService()

@router.get("/title")
async def get_property_title(
    lat: float = Query(..., description="Latitude of the property (WGS84)"),
    lng: float = Query(..., description="Longitude of the property (WGS84)")
):
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

@router.get("/council")
async def get_council(
    lat: float = Query(..., description="Latitude (WGS84)"),
    lng: float = Query(..., description="Longitude (WGS84)")
):
    try:
        result = await linz_service.get_council_by_coords(lat, lng)
        if not result:
            raise HTTPException(status_code=404, detail="No Territorial Authority found.")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/building-details")
async def get_building_details(
    lat: float = Query(..., description="Latitude (WGS84)"),
    lng: float = Query(..., description="Longitude (WGS84)")
):
    try:
        result = await linz_service.get_building_details_by_coords(lat, lng)
        if not result:
            raise HTTPException(status_code=404, detail="No building details found.")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/bridge")
async def get_property_bridge(
    lat: float = Query(..., description="Latitude (WGS84)"),
    lng: float = Query(..., description="Longitude (WGS84)")
):
    try:
        result = await linz_service.get_bridge_data_by_coords(lat, lng)
        if not result:
            raise HTTPException(status_code=404, detail="No bridge record found.")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")
