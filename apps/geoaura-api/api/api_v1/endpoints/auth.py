import os
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
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


def verify_token(credentials: HTTPAuthorizationCredentials = Depends(_bearer)) -> dict:
    token = credentials.credentials
    try:
        payload = jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
        )
        return payload
    except JWTError as exc:
        logger.warning("JWT verification failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
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
