import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from api.api_v1.api import api_router

app = FastAPI(
    title="GeoAura NZ API",
    description="Agentic Urban Risk Analysis for New Zealand Property & Compliance",
    version="0.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200", "https://geoaura.co.nz"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")

@app.get("/", tags=["General"])
def root():
    return {"message": "GeoAura API Initialized"}