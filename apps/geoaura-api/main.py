import asyncio
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from api.api_v1.api import api_router
from services.report_worker import report_worker_loop

app = FastAPI(
    title="GeoAura NZ API",
    description="Agentic Urban Risk Analysis for New Zealand Property & Compliance",
    version="0.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200", "https://geoaura.aswanth.net"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


@app.on_event("startup")
async def start_report_worker() -> None:
    if os.getenv("RUN_REPORT_WORKER") == "1":
        asyncio.create_task(report_worker_loop())

@app.get("/", tags=["General"])
def root():
    return {"message": "GeoAura API Initialized"}

@app.get("/health", tags=["General"])
@app.head("/health", tags=["General"])
def health():
    return {"status": "active"}