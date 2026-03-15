from fastapi import APIRouter
from .endpoints import properties

api_router = APIRouter()
api_router.include_router(properties.router, prefix="/properties", tags=["Properties"])
