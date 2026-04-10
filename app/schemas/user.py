import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr


class UserProfile(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    avatar_url: str | None = None
    phone: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    full_name: str | None = None
    avatar_url: str | None = None
    phone: str | None = None


class UserSearchResult(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    avatar_url: str | None = None

    model_config = {"from_attributes": True}


class InviteRequest(BaseModel):
    email: EmailStr
    message: str | None = None
