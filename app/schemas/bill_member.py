import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr


class MemberAdd(BaseModel):
    user_id: uuid.UUID | None = None
    email: EmailStr | None = None
    nickname: str


class MemberUpdate(BaseModel):
    nickname: str | None = None
    status: str | None = None


class BillMemberOut(BaseModel):
    id: uuid.UUID
    bill_id: uuid.UUID
    user_id: uuid.UUID | None = None
    email: str | None = None
    nickname: str
    status: str
    invited_at: datetime
    joined_at: datetime | None = None

    model_config = {"from_attributes": True}


class InviteLinkOut(BaseModel):
    invite_url: str
    token: str
    expires_at: datetime
