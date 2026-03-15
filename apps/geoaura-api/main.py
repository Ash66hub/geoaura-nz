import os
from fastapi import FastAPI
from dotenv import load_dotenv

load_dotenv()

from api.api_v1.api import api_router

app = FastAPI(
    title="GeoAura NZ API",
    description="Agentic Urban Risk Analysis for New Zealand Property & Compliance",
    version="0.1.0"
)

app.include_router(api_router, prefix="/api/v1")

@app.get("/", tags=["General"])
def root():
    return {"message": "GeoAura API Initialized"}