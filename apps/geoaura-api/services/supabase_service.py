import os
import logging
from typing import List, Dict, Any
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
