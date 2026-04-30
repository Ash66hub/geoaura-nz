import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.agent_service import AgentService

router = APIRouter()
logger = logging.getLogger(__name__)

_agent_service: Optional[AgentService] = None


def _get_agent() -> AgentService:
    global _agent_service
    if _agent_service is None:
        _agent_service = AgentService()
    return _agent_service


class ReportRequest(BaseModel):
    lat: float
    lng: float
    address: str
    user_type: str = "buyer"
    flood_data: dict | None = None


@router.post("/generate")
async def generate_report(request: ReportRequest):
    """
    Trigger agentic data gathering and AI synthesis for a given address.
    Returns a structured property intelligence report as JSON.
    """
    try:
        agent = _get_agent()
        report = await agent.generate_report(
            request.lat, request.lng, request.address,
            user_type=request.user_type,
            flood_data=request.flood_data,
        )
        return report
    except Exception as exc:
        logger.exception("Report generation failed for %s", request.address)
        raise HTTPException(
            status_code=500,
            detail=f"Report generation failed: {exc}",
        )
