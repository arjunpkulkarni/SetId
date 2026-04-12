import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=1, max_length=255)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserBrief(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    avatar_url: str | None = None
    phone: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class SendOtpRequest(BaseModel):
    phone: str = Field(min_length=8, max_length=32)


class VerifyOtpRequest(BaseModel):
    phone: str = Field(min_length=8, max_length=32)
    code: str = Field(min_length=4, max_length=10)
    first_name: str = Field(min_length=1, max_length=100)

    @field_validator("first_name", mode="before")
    @classmethod
    def strip_first_name(cls, v: str) -> str:
        if isinstance(v, str):
            return v.strip()
        return v


class PhoneAuthData(BaseModel):
    """Tokens + user for phone OTP completion."""

    token: str
    access_token: str
    user: UserBrief


class AppleSignInRequest(BaseModel):
    identity_token: str
    authorization_code: str | None = None
    user_info: dict | None = None  # First-time sign in includes name


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserBrief
