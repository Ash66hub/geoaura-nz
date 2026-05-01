import logging
from typing import Optional, List

from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from pydantic import BaseModel

from services.agent_service import AgentService
from services.supabase_service import SupabaseService
from api.api_v1.endpoints.auth import verify_token

router = APIRouter()
logger = logging.getLogger(__name__)

_agent_service: Optional[AgentService] = None
_supabase_service: Optional[SupabaseService] = None


def _get_agent() -> AgentService:
    global _agent_service
    if _agent_service is None:
        _agent_service = AgentService()
    return _agent_service

def _get_supabase() -> SupabaseService:
    global _supabase_service
    if _supabase_service is None:
        _supabase_service = SupabaseService()
    return _supabase_service


class ReportRequest(BaseModel):
    lat: float
    lng: float
    address: str
    user_type: str = "buyer"
    flood_data: dict | None = None


@router.post("/generate")
async def generate_report(
    request: ReportRequest, 
    background_tasks: BackgroundTasks,
    payload: dict = Depends(verify_token)
):
    """
    Trigger agentic data gathering and AI synthesis for a given address in the background.
    Returns the report ID immediately.
    """
    try:
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="User ID not found in token")

        supabase = _get_supabase()
        agent = _get_agent()
        
        # 1. Create a pending report record
        report = supabase.create_report(
            user_id=user_id,
            address=request.address,
            lat=request.lat,
            lng=request.lng,
            user_type=request.user_type
        )
        
        report_id = report["id"]
        
        # 2. Trigger background processing
        background_tasks.add_task(
            agent.generate_report,
            lat=request.lat,
            lng=request.lng,
            address=request.address,
            user_type=request.user_type,
            flood_data=request.flood_data,
            report_id=report_id
        )
        
        return {"id": report_id, "status": "PENDING"}
    except Exception as exc:
        logger.exception("Report generation trigger failed for %s", request.address)
        raise HTTPException(
            status_code=500,
            detail=f"Report generation trigger failed: {exc}",
        )

@router.get("/", response_model=List[dict])
async def list_reports(payload: dict = Depends(verify_token)):
    """
    List all reports for the current user.
    """
    supabase = _get_supabase()
    return supabase.get_reports_for_user(payload.get("sub"))

@router.get("/{report_id}")
async def get_report(report_id: str, payload: dict = Depends(verify_token)):
    """
    Get a specific report by ID.
    """
    supabase = _get_supabase()
    report = supabase.get_report_by_id(report_id)
    
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    if report.get("user_id") != payload.get("sub"):
        raise HTTPException(status_code=403, detail="Forbidden")
        
    return report

@router.delete("/{report_id}")
async def delete_report(report_id: str, payload: dict = Depends(verify_token)):
    """
    Delete a specific report by ID.
    """
    supabase = _get_supabase()
    report = supabase.get_report_by_id(report_id)
    
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    if report.get("user_id") != payload.get("sub"):
        raise HTTPException(status_code=403, detail="Forbidden")
        
    supabase.delete_report(report_id)
    return {"status": "deleted"}
