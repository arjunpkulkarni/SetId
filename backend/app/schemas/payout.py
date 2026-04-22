"""Pydantic schemas for the Stripe Connect routes."""

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator


class PayoutOut(BaseModel):
    id: uuid.UUID
    stripe_payout_id: str
    amount_cents: int
    currency: str
    status: str
    method: str
    arrival_date: int | None = None
    failure_code: str | None = None
    failure_message: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class OnboardingLinkOut(BaseModel):
    url: str
    expires_at: int | None = None


class ConnectStatusOut(BaseModel):
    """Returned by `GET /stripe/connect/status`. Mirrors the dataclass
    produced by `StripeConnectService.refresh_account_status`."""

    connected: bool
    charges_enabled: bool
    payouts_enabled: bool
    details_submitted: bool
    has_instant_external_account: bool
    external_account_last4: str | None = None
    external_account_brand: str | None = None
    requirements_due: list[str] = Field(default_factory=list)
    requirements_past_due: list[str] = Field(default_factory=list)
    disabled_reason: str | None = None


class BalanceOut(BaseModel):
    """Pending balance — the amount that will go out in the next
    automatic daily payout. Not instant-payable; we no longer run
    instant payouts."""

    available_cents: int
    currency: str = "usd"


class PayoutsSetupIndividual(BaseModel):
    """Identity fields the mobile app collects in-app for Custom Connect
    onboarding. All required per Stripe's US KYC minimum.
    """

    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    email: EmailStr
    phone: str = Field(..., min_length=4, max_length=20)  # E.164 preferred

    dob_day: int = Field(..., ge=1, le=31)
    dob_month: int = Field(..., ge=1, le=12)
    # 1900 floor avoids junk; current-year ceiling enforced client-side.
    dob_year: int = Field(..., ge=1900, le=datetime.now().year)

    address_line1: str = Field(..., min_length=1, max_length=200)
    address_city: str = Field(..., min_length=1, max_length=100)
    address_state: str = Field(..., min_length=2, max_length=2)
    address_postal_code: str = Field(..., min_length=3, max_length=10)

    ssn_last_4: str = Field(..., min_length=4, max_length=4)

    @field_validator("ssn_last_4")
    @classmethod
    def _ssn_digits(cls, v: str) -> str:
        v = v.strip()
        if not v.isdigit():
            raise ValueError("ssn_last_4 must be 4 digits")
        return v

    @field_validator("address_state")
    @classmethod
    def _state_upper(cls, v: str) -> str:
        return v.strip().upper()


class ExternalAccountUpdateRequest(BaseModel):
    """Body of `POST /stripe/connect/external-account` — the "change
    card on file" flow. Expects only a card token; identity has already
    been submitted during the initial payout-method setup.

    `card_token` is a `tok_...` from the Stripe React Native SDK's
    `createToken({ type: 'Card', currency: 'usd', ... })`. The raw card
    number never leaves the phone.
    """

    card_token: str = Field(..., min_length=1, max_length=100)


class PayoutsSetupRequest(BaseModel):
    """Body of `POST /stripe/connect/setup`. Combines the in-app KYC
    form with the client-tokenized debit card.

    `card_token` is a `tok_...` string returned by the Stripe React
    Native SDK's `createToken({ type: 'Card', currency: 'usd', ... })`.
    Attached as the external account on the host's Connect account.

    `payment_method_id` is an optional `pm_...` for the SAME card,
    created via `createPaymentMethod({ paymentMethodType: 'Card' })`.
    When present, the server also attaches it to the user's Stripe
    Customer so the same card works for paying bills — no redundant
    second "add payment method" step.

    The raw card number never leaves the phone.
    """

    individual: PayoutsSetupIndividual
    card_token: str = Field(..., min_length=1, max_length=100)
    payment_method_id: str | None = Field(
        default=None, min_length=1, max_length=100
    )
