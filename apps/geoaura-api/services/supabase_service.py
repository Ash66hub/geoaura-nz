import os
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any, Optional
from supabase import create_client, Client

logger = logging.getLogger(__name__)

class SupabaseService:
    def __init__(self):
        self.url = os.getenv("SUPABASE_URL")
        self.key = os.getenv("SUPABASE_KEY")
        if not self.url or not self.key:
            logger.warning("Supabase credentials missing in .env")
            self.client = None
        else:
            self.client: Client = create_client(self.url, self.key)

    def search_regulatory_documents(
        self, 
        query_embedding: List[float], 
        doc_type: str = "building_code", 
        match_threshold: float = 0.5, 
        match_count: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Performs vector similarity search using the match_documents RPC function.
        """
        if not self.client:
            return []

        try:
            params = {
                "query_embedding": query_embedding,
                "match_threshold": match_threshold,
                "match_count": match_count,
                "filter_type": doc_type
            }
            
            response = self.client.rpc("match_documents", params).execute()
            return response.data or []
        except Exception as e:
            logger.error(f"Error searching regulatory documents: {e}")
            return []

    def create_report(self, user_id: str, address: str, lat: float, lng: float, user_type: str) -> Dict[str, Any]:
        if not self.client:
            raise Exception("Supabase client not initialized")
        
        data = {
            "user_id": user_id,
            "address": address,
            "lat": lat,
            "lng": lng,
            "user_type": user_type,
            "status": "QUEUED"
        }
        response = self.client.table("reports").insert(data).execute()
        return response.data[0]

    def update_report(
        self,
        report_id: str,
        status: str,
        result: Optional[Dict[str, Any]] = None,
        error_message: Optional[str] = None,
    ) -> None:
        if not self.client:
            return
        
        data = {"status": status, "updated_at": "now()"}
        if result:
            data["result"] = result
        elif error_message:
            data["result"] = {"error": error_message}
        
        self.client.table("reports").update(data).eq("id", report_id).execute()

    def get_report_queue_depth(self, statuses: List[str]) -> int:
        if not self.client:
            return 0

        response = (
            self.client.table("reports")
            .select("id", count="exact")
            .in_("status", statuses)
            .execute()
        )
        if response.count is not None:
            return int(response.count)
        return len(response.data or [])

    def get_next_queued_report(self) -> Dict[str, Any]:
        if not self.client:
            return {}

        response = (
            self.client.table("reports")
            .select("*")
            .eq("status", "QUEUED")
            .order("created_at", desc=False)
            .limit(1)
            .execute()
        )
        data = response.data or []
        return data[0] if data else {}

    def claim_report(self, report_id: str) -> bool:
        if not self.client:
            return False

        response = (
            self.client.table("reports")
            .update({"status": "PROCESSING", "updated_at": "now()"})
            .eq("id", report_id)
            .eq("status", "QUEUED")
            .execute()
        )
        return bool(response.data)

    def requeue_stale_processing_reports(self, stale_after_seconds: int) -> int:
        if not self.client:
            return 0

        cutoff = datetime.now(timezone.utc) - timedelta(seconds=stale_after_seconds)
        cutoff_iso = cutoff.isoformat()

        response = (
            self.client.table("reports")
            .update({"status": "QUEUED", "updated_at": "now()"})
            .eq("status", "PROCESSING")
            .lt("updated_at", cutoff_iso)
            .execute()
        )
        return len(response.data or [])

    def get_reports_for_user(self, user_id: str) -> List[Dict[str, Any]]:
        if not self.client:
            return []
        
        response = self.client.table("reports") \
            .select("*") \
            .eq("user_id", user_id) \
            .order("created_at", desc=True) \
            .execute()
        return response.data or []

    def get_report_by_id(self, report_id: str) -> Dict[str, Any]:
        if not self.client:
            return {}
        
        response = self.client.table("reports").select("*").eq("id", report_id).single().execute()
        return response.data or {}

    def delete_report(self, report_id: str) -> None:
        if not self.client:
            return
        
        self.client.table("reports").delete().eq("id", report_id).execute()
