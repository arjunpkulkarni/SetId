import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class VirtualCardOut(BaseModel):
    id: uuid.UUID
    bill_id: uuid.UUID
    status: str
    is_active: bool
    spending_limit_cents: int | None = None
    currency: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class VirtualCardSummary(BaseModel):
    id: uuid.UUID
    bill_id: uuid.UUID
    status: str
    is_active: bool
    spending_limit_cents: int | None = None
    currency: str
    created_at: datetime

    model_config = {"from_attributes": True}
