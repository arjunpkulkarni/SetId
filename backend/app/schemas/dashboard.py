import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class DashboardOverview(BaseModel):
    total_bills: int
    active_bills: int
    settled_bills: int
    total_owed_to_you: Decimal
    total_you_owe: Decimal


class ActiveBillSummary(BaseModel):
    id: uuid.UUID
    title: str
    merchant_name: str | None = None
    total: Decimal
    your_share: Decimal
    paid: Decimal
    remaining: Decimal
    member_count: int
    status: str
    created_at: datetime


class RecentActivity(BaseModel):
    type: str
    description: str
    bill_id: uuid.UUID | None = None
    bill_title: str | None = None
    amount: Decimal | None = None
    timestamp: datetime
