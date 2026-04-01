from fastapi import APIRouter
from .endpoints import properties, flood, proxy, seismic, police, traffic

api_router = APIRouter()
api_router.include_router(properties.router, prefix="/properties", tags=["Properties"])
api_router.include_router(flood.router, prefix="/flood", tags=["Flood Hazard"])
api_router.include_router(seismic.router, prefix="/seismic", tags=["Seismic Events"])
api_router.include_router(proxy.router, prefix="/proxy", tags=["Proxy"])
api_router.include_router(police.router, prefix="/police", tags=["Police Incidents"])
api_router.include_router(traffic.router, prefix="/traffic", tags=["Traffic Volume"])
