import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.security import decode_access_token
from app.models.user import User

security = HTTPBearer()


def _auth_error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
    )


def get_token_payload(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    token = credentials.credentials
    payload = decode_access_token(token)
    if not payload:
        raise _auth_error(
            status.HTTP_401_UNAUTHORIZED, "INVALID_TOKEN", "Invalid or expired token"
        )
    sub = payload.get("sub")
    if not sub:
        raise _auth_error(
            status.HTTP_401_UNAUTHORIZED, "INVALID_TOKEN", "Token missing subject"
        )
    try:
        uuid.UUID(str(sub))
    except ValueError:
        raise _auth_error(
            status.HTTP_401_UNAUTHORIZED, "INVALID_TOKEN", "Invalid token subject"
        )
    return payload


def get_current_user(
    payload: dict = Depends(get_token_payload),
    db: Session = Depends(get_db),
) -> User:
    user_id = payload["sub"]
    user = (
        db.query(User)
        .filter(User.id == user_id, User.is_active.is_(True))
        .first()
    )
    if not user:
        raise _auth_error(
            status.HTTP_404_NOT_FOUND,
            "PROFILE_NOT_FOUND",
            "No profile exists for this account. Complete onboarding first.",
        )
    return user
