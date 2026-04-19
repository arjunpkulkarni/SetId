import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.core.response import success_response, error_response
from app.schemas.user import UserProfile, UserUpdate, UserSearchResult, InviteRequest

router = APIRouter(prefix="/users", tags=["Users"])


@router.get("/me")
def get_my_profile(current_user: User = Depends(get_current_user)):
    profile = UserProfile.model_validate(current_user)
    return success_response(data=profile.model_dump())


@router.patch("/me")
def update_my_profile(
    body: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(current_user, field, value)

    db.commit()
    db.refresh(current_user)

    profile = UserProfile.model_validate(current_user)
    return success_response(data=profile.model_dump(), message="Profile updated")


@router.get("/search")
def search_users(
    q: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    pattern = f"%{q}%"
    users = (
        db.query(User)
        .filter(
            User.is_active.is_(True),
            (User.email.ilike(pattern) | User.full_name.ilike(pattern)),
        )
        .limit(20)
        .all()
    )
    results = [UserSearchResult.model_validate(u).model_dump() for u in users]
    return success_response(data=results)


@router.post("/invite")
def invite_user(
    body: InviteRequest,
    current_user: User = Depends(get_current_user),
):
    return error_response(
        "NOT_IMPLEMENTED",
        "Email invites are not enabled yet.",
        501,
    )


@router.get("/{user_id}")
def get_user_profile(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()
    if not user:
        return error_response("NOT_FOUND", "User not found", 404)

    profile = UserProfile.model_validate(user)
    return success_response(data=profile.model_dump())
