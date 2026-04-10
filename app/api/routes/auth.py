from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.core.response import success_response, error_response
from app.schemas.auth import SignupRequest, LoginRequest, AuthResponse, UserBrief
from app.services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["Auth"])


@router.post("/signup")
def signup(body: SignupRequest, db: Session = Depends(get_db)):
    svc = AuthService(db)
    try:
        user, token = svc.signup(
            email=body.email,
            password=body.password,
            full_name=body.full_name,
        )
    except ValueError:
        return error_response("EMAIL_EXISTS", "A user with this email already exists", 409)

    auth_data = AuthResponse(
        access_token=token,
        token_type="bearer",
        user=UserBrief.model_validate(user),
    )
    return success_response(data=auth_data.model_dump(), message="Account created successfully")


@router.post("/login")
def login(body: LoginRequest, db: Session = Depends(get_db)):
    svc = AuthService(db)
    try:
        user, token = svc.login(email=body.email, password=body.password)
    except ValueError:
        return error_response("INVALID_CREDENTIALS", "Invalid email or password", 401)

    auth_data = AuthResponse(
        access_token=token,
        token_type="bearer",
        user=UserBrief.model_validate(user),
    )
    return success_response(data=auth_data.model_dump(), message="Login successful")


@router.get("/me")
def get_me(current_user: User = Depends(get_current_user)):
    user_brief = UserBrief.model_validate(current_user)
    return success_response(data=user_brief.model_dump())


@router.post("/logout")
def logout(current_user: User = Depends(get_current_user)):
    return success_response(message="Logged out successfully")
