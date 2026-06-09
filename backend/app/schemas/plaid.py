from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class PlaidLinkTokenRequest(BaseModel):
    purpose: Literal["payout", "guest_pay"]
    payment_id: UUID | None = None
    pay_token: str | None = Field(None, min_length=8, max_length=128)

    @model_validator(mode="after")
    def guest_pay_needs_reference(self) -> "PlaidLinkTokenRequest":
        if self.purpose == "guest_pay" and not self.payment_id and not self.pay_token:
            raise ValueError("payment_id or pay_token is required for guest_pay")
        return self


class PlaidLinkTokenResponse(BaseModel):
    link_token: str
    expiration: str


class PlaidCompletePayoutRequest(BaseModel):
    public_token: str = Field(..., min_length=1)
    account_id: str = Field(..., min_length=1)
    metadata: dict[str, Any] | None = None


class PlaidCompleteGuestPayRequest(BaseModel):
    public_token: str = Field(..., min_length=1)
    account_id: str = Field(..., min_length=1)
    payment_id: UUID | None = None
    pay_token: str | None = Field(None, min_length=8, max_length=128)

    @model_validator(mode="after")
    def needs_payment_ref(self) -> "PlaidCompleteGuestPayRequest":
        if not self.payment_id and not self.pay_token:
            raise ValueError("payment_id or pay_token is required")
        return self


class PlaidPayoutCompleteResponse(BaseModel):
    connected: bool
    payouts_enabled: bool
    external_account_last4: str | None = None
    external_account_type: str | None = None


class PlaidGuestPayCompleteResponse(BaseModel):
    payment_id: str
    status: str
    stripe_payment_intent_id: str | None = None
    bank_last4: str | None = None
