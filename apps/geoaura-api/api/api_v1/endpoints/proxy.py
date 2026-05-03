from fastapi import APIRouter, HTTPException, Query, Request
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

import os

@router.get("/linz-basemaps/{path:path}")
async def proxy_linz_basemaps(request: Request, path: str):
    linz_api_key = os.getenv("LINZ_BASEMAPS_API_KEY")
    if not linz_api_key:
        raise HTTPException(status_code=500, detail="LINZ Basemaps API Key not configured")
        
    # Start with the base URL and append the API key
    base_url = f"https://basemaps.linz.govt.nz/v1/{path}?api={linz_api_key}"
    
    # Forward any other query parameters (like tileMatrix, pipeline, etc.)
    for key, value in request.query_params.items():
        base_url += f"&{key}={value}"
    
    # We use a short timeout since map tiles should return quickly
    async with httpx.AsyncClient(verify=False, follow_redirects=True) as client:
        try:
            resp = await client.get(base_url, timeout=10.0)
            resp.raise_for_status()
            
            content = resp.content
            media_type = resp.headers.get("content-type", "")
            
            # If it's a JSON response (like a style or tile.json), we must rewrite the LINZ URLs
            # to point back to our proxy so the browser doesn't try to fetch them directly,
            # which would either fail or leak the API key (which LINZ injects into the JSON).
            if "json" in media_type:
                # E.g., request.base_url is "https://api-geoaura.aswanth.net/"
                proxy_base_url = str(request.base_url).rstrip("/") + "/api/v1/proxy/linz-basemaps/"
                content_str = content.decode("utf-8")
                
                # Replace the base domain
                content_str = content_str.replace("https://basemaps.linz.govt.nz/v1/", proxy_base_url)
                
                # Strip out the API key that LINZ automatically embeds in its JSON templates
                content_str = content_str.replace(f"?api={linz_api_key}", "")
                content_str = content_str.replace(f"&api={linz_api_key}", "")
                
                content = content_str.encode("utf-8")
            
            return Response(
                content=content, 
                status_code=resp.status_code, 
                media_type=media_type
            )
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=exc.response.status_code, detail=f"LINZ API Error: {exc.response.text}")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))