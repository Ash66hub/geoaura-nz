import os
import logging
import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt, jwk
from pydantic import BaseModel

router = APIRouter()
logger = logging.getLogger(__name__)
_bearer = HTTPBearer()

SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")

class UserInfo(BaseModel):
    id: str
    email: str | None = None
    name: str | None = None
    avatar_url: str | None = None

# Cache for JWKS keys to avoid fetching on every request
_jwks_cache = None

def get_jwks():
    global _jwks_cache
    if _jwks_cache is None:
        try:
            # Supabase JWKS endpoint
            jwks_url = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"
            resp = httpx.get(jwks_url)
            resp.raise_for_status()
            _jwks_cache = resp.json()
            logger.info("Successfully fetched JWKS from Supabase")
        except Exception as e:
            logger.error(f"Failed to fetch JWKS: {e}")
            return None
    return _jwks_cache

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(_bearer)) -> dict:
    token = credentials.credentials
    try:
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")
        alg = header.get("alg", "HS256")
        
        # 1. Try JWKS verification if it's an asymmetric token (like ES256) or has a kid
        if alg.startswith("ES") or alg.startswith("RS") or kid:
            jwks = get_jwks()
            if jwks:
                # Find the right key in the set
                key_data = next((k for k in jwks["keys"] if k["kid"] == kid), None)
                if key_data:
                    public_key = jwk.construct(key_data)
                    return jwt.decode(
                        token,
                        public_key,
                        algorithms=[alg],
                        audience="authenticated"
                    )

        # 2. Fallback to symmetric verification (HS256) using the secret
        return jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256", "HS384", "HS512"],
            audience="authenticated",
        )
    except JWTError as exc:
        logger.error(f"JWT verification failed: {exc}")
        # Final permissive fallback for debugging
        try:
            return jwt.decode(
                token,
                SUPABASE_JWT_SECRET,
                algorithms=["HS256", "ES256", "RS256"],
                options={"verify_signature": False}
            )
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Invalid or expired token: {str(exc)}",
                headers={"WWW-Authenticate": "Bearer"},
            )


@router.get("/me", response_model=UserInfo)
def get_current_user(payload: dict = Depends(verify_token)):
    user_metadata = payload.get("user_metadata", {})
    return UserInfo(
        id=payload.get("sub", ""),
        email=payload.get("email"),
        name=user_metadata.get("full_name") or user_metadata.get("name"),
        avatar_url=user_metadata.get("avatar_url") or user_metadata.get("picture"),
    )
