import uuid
from datetime import datetime

from pydantic import BaseModel


class SetupIntentOut(BaseModel):
    client_secret: str
    stripe_publishable_key: str


class AttachPaymentMethodRequest(BaseModel):
    payment_method_id: str


class PaymentMethodOut(BaseModel):
    id: uuid.UUID
    stripe_payment_method_id: str
    card_brand: str | None = None
    card_last4: str | None = None
    card_exp_month: int | None = None
    card_exp_year: int | None = None
    is_default: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}
