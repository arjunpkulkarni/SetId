import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class BillCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    merchant_name: str | None = None
    currency: str = "USD"
    notes: str | None = None


class BillUpdate(BaseModel):
    title: str | None = None
    merchant_name: str | None = None
    currency: str | None = None
    subtotal: Decimal | None = None
    tax: Decimal | None = None
    expected_party_size: int | None = None
    tip: Decimal | None = None
    tip_split_mode: Literal["proportional", "no_tip"] | None = None
    service_fee: Decimal | None = None
    receipt_extra_fees: Decimal | None = None
    total: Decimal | None = None
    notes: str | None = None
    status: str | None = None

    @field_validator("expected_party_size")
    @classmethod
    def validate_expected_party_size(cls, v: int | None) -> int | None:
        if v is None:
            return v
        if v < 2 or v > 999:
            raise ValueError("expected_party_size must be between 2 and 999")
        return v


class BillOut(BaseModel):
    id: uuid.UUID
    title: str
    merchant_name: str | None = None
    currency: str
    status: str
    owner_id: uuid.UUID
    subtotal: Decimal
    tax: Decimal
    expected_party_size: int | None = None
    tip: Decimal
    tip_split_mode: str = "proportional"
    service_fee: Decimal
    service_fee_type: str | None = None
    service_fee_percentage: Decimal | None = None
    receipt_extra_fees: Decimal
    total: Decimal
    notes: str | None = None
    member_count: int = 0
    ready_to_pay: bool = False
    ready_reason: str | None = None
    ready_marked_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MarkReadyRequest(BaseModel):
    reason: Literal["fully_collected", "owner_override"] = "fully_collected"
    notes: str | None = Field(default=None, max_length=500)


class ReadinessOut(BaseModel):
    bill_id: uuid.UUID
    ready_to_pay: bool
    total_collected: Decimal
    amount_to_collect: Decimal
    bill_total: Decimal
    collection_pct: Decimal
    meets_threshold: bool
    ready_reason: str | None = None
    ready_marked_at: datetime | None = None
    ready_marked_by: uuid.UUID | None = None


class ServiceFeeUpdate(BaseModel):
    fee_type: Literal["flat", "percentage"]
    percentage: Decimal | None = Field(default=None, ge=0, le=100, description="Percentage (0-100) for percentage-based fees")


class BillActivity(BaseModel):
    type: str
    description: str
    timestamp: datetime
    actor_name: str | None = None
