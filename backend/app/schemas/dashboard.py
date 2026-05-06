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
    updated_at: datetime | None = None
    # ── Whose bill is this, and how complete is it overall? ───────────────
    # `is_host` lets the dashboard pick the right "complete" rule per bill:
    #   - Host: everyone has paid their share (`bill_remaining` ≈ 0).
    #   - Guest: they personally have paid (`remaining` ≈ 0).
    # `bill_paid` / `bill_remaining` aggregate across all NON-host members,
    # so the host's row (which is always 0/0 in the per-member view) doesn't
    # mask the fact that real money has been collected. Default to 0 so old
    # clients without these fields keep working.
    is_host: bool = False
    bill_paid: Decimal = Decimal("0")
    bill_remaining: Decimal = Decimal("0")


class RecentActivity(BaseModel):
    type: str
    description: str
    bill_id: uuid.UUID | None = None
    bill_title: str | None = None
    amount: Decimal | None = None
    timestamp: datetime
