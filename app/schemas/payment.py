import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class PaymentIntentCreate(BaseModel):
    bill_id: uuid.UUID
    member_id: uuid.UUID
    amount: Decimal
    currency: str = "USD"


class PaymentOut(BaseModel):
    id: uuid.UUID
    bill_id: uuid.UUID
    bill_member_id: uuid.UUID
    user_id: uuid.UUID | None = None
    amount: Decimal
    currency: str
    status: str
    stripe_payment_intent_id: str | None = None
    stripe_client_secret: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
