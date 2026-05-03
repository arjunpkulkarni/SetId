import uuid
from datetime import datetime

from typing import Literal

from pydantic import BaseModel, EmailStr, Field, computed_field, field_validator

# Default display name when Apple does not share the user's name (most logins).
APPLE_PLACEHOLDER_FULL_NAME = "Apple User"


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
    auth_provider: str = "email"
    created_at: datetime

    model_config = {"from_attributes": True}

    @computed_field
    @property
    def needs_display_name(self) -> bool:
        """True when the user still has the generic Apple placeholder and should pick a real name."""
        ap = (self.auth_provider or "").lower()
        return ap == "apple" and (self.full_name or "").strip() == APPLE_PLACEHOLDER_FULL_NAME


class SendOtpRequest(BaseModel):
    phone: str = Field(min_length=8, max_length=32)
    # signup = new account only; login = existing phone only. Omit for legacy clients (flexible).
    intent: Literal["signup", "login"] | None = None


class VerifyOtpRequest(BaseModel):
    phone: str = Field(min_length=8, max_length=32)
    code: str = Field(min_length=4, max_length=10)
    # Empty allowed for returning-user phone login; signup sends a non-empty name.
    first_name: str = Field(default="", max_length=100)
    intent: Literal["signup", "login"] | None = None

    @field_validator("code", mode="before")
    @classmethod
    def coerce_code_str(cls, v: object) -> str:
        if v is None:
            return ""
        return str(v).strip()

    @field_validator("first_name", mode="before")
    @classmethod
    def strip_first_name(cls, v: object) -> str:
        if v is None:
            return ""
        if isinstance(v, str):
            return v.strip()
        return str(v).strip()


class CreateProfileRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=255)


class PhoneAuthData(BaseModel):
    """Tokens + user for phone OTP completion."""

    token: str
    access_token: str
    user: UserBrief | None = None
    needs_profile: bool = False


class AppleSignInRequest(BaseModel):
    identity_token: str
    authorization_code: str | None = None
    user_info: dict | None = None  # First-time sign in includes name


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserBrief
