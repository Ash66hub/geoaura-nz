from fastapi import APIRouter, HTTPException, Query
import httpx
from fastapi.responses import Response

router = APIRouter()

@router.get("/hamilton-hazard")
async def proxy_hamilton_hazard(url: str = Query(...)):
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        "Accept": "*/*"
    }
    
    # follow_redirects=True is required for httpx, as many ArcGIS servers do redirect bouncing.
    async with httpx.AsyncClient(verify=False, follow_redirects=True, headers=headers) as client:
        try:
            resp = await client.get(url, timeout=120.0)
            
            # Optionally raise for status if it is a graceful failure to see standard HTTP errors instead of python exception 500s.
            resp.raise_for_status()
            
            return Response(
                content=resp.content, 
                status_code=resp.status_code, 
                media_type=resp.headers.get("content-type", "application/json")
            )
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=exc.response.status_code, detail=f"Hamilton API Error: {exc.response.text}")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))