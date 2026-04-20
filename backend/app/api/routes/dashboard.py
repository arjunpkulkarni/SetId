"""
Dashboard endpoints.

Performance notes:
  The original implementation did a per-bill, per-member pair of queries
  (`ItemAssignment` sum + `Payment` sum), which grew as O(B·M) round-trips
  and made a warm dashboard take 1-5s over a real network. We now compute
  both aggregates with two GROUP BY queries scoped to the caller's bills,
  and the overview / active-bills / combined endpoints all reuse the same
  in-memory maps — so a typical call is 4 SQL statements regardless of
  how many bills or members the user has.

  `/dashboard` is the preferred endpoint (single round-trip for both the
  hero balance and the active bill list). The legacy `/overview` and
  `/active-bills` endpoints are kept so older clients still work.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.bill import Bill
from app.models.bill_member import BillMember
from app.models.item_assignment import ItemAssignment
from app.models.payment import Payment
from app.models.user import User
from app.core.response import success_response
from app.schemas.dashboard import ActiveBillSummary, DashboardOverview, RecentActivity

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


# ─── Shared aggregation helpers ──────────────────────────────────────────────
#
# These are intentionally module-private. They pull every bill the user is
# associated with plus the per-`bill_member` owed/paid totals in a constant
# number of queries, and hand back plain dicts so the public endpoints can
# slice them however they want without issuing more SQL.


@dataclass
class _DashboardAggregates:
    bills: list[Bill]
    # member_id -> sum(amount_owed) for that member's assignments
    owed_by_member: dict[uuid.UUID, Decimal]
    # member_id -> sum(amount) for that member's succeeded payments
    paid_by_member: dict[uuid.UUID, Decimal]
    # bill_id -> list[BillMember]
    members_by_bill: dict[uuid.UUID, list[BillMember]]


_ZERO = Decimal("0")


def _load_dashboard_aggregates(db: Session, user_id: str) -> _DashboardAggregates:
    """Fetch every bill + per-member owed/paid totals for `user_id` in 4 queries.

    This replaces the per-bill / per-member loops that were issuing
    O(B·M) round-trips.
    """

    # 1. All bills where the user is owner OR a member.
    member_bill_ids_subq = (
        db.query(BillMember.bill_id)
        .filter(BillMember.user_id == user_id)
        .subquery()
    )
    bills: list[Bill] = (
        db.query(Bill)
        .filter(or_(Bill.owner_id == user_id, Bill.id.in_(member_bill_ids_subq)))
        .order_by(Bill.created_at.desc())
        .all()
    )

    if not bills:
        return _DashboardAggregates(
            bills=[],
            owed_by_member={},
            paid_by_member={},
            members_by_bill={},
        )

    bill_ids = [b.id for b in bills]

    # 2. All members of those bills in one query.
    members: list[BillMember] = (
        db.query(BillMember).filter(BillMember.bill_id.in_(bill_ids)).all()
    )
    members_by_bill: dict[uuid.UUID, list[BillMember]] = {}
    for m in members:
        members_by_bill.setdefault(m.bill_id, []).append(m)

    if not members:
        return _DashboardAggregates(
            bills=bills,
            owed_by_member={},
            paid_by_member={},
            members_by_bill=members_by_bill,
        )

    member_ids = [m.id for m in members]

    # 3. Sum(amount_owed) grouped by bill_member_id — one query.
    owed_rows = (
        db.query(
            ItemAssignment.bill_member_id,
            func.coalesce(func.sum(ItemAssignment.amount_owed), 0),
        )
        .filter(ItemAssignment.bill_member_id.in_(member_ids))
        .group_by(ItemAssignment.bill_member_id)
        .all()
    )
    owed_by_member: dict[uuid.UUID, Decimal] = {
        row[0]: Decimal(row[1] or 0) for row in owed_rows
    }

    # 4. Sum(amount) of succeeded payments grouped by bill_member_id — one query.
    paid_rows = (
        db.query(
            Payment.bill_member_id,
            func.coalesce(func.sum(Payment.amount), 0),
        )
        .filter(
            Payment.bill_member_id.in_(member_ids),
            Payment.status == "succeeded",
        )
        .group_by(Payment.bill_member_id)
        .all()
    )
    paid_by_member: dict[uuid.UUID, Decimal] = {
        row[0]: Decimal(row[1] or 0) for row in paid_rows
    }

    return _DashboardAggregates(
        bills=bills,
        owed_by_member=owed_by_member,
        paid_by_member=paid_by_member,
        members_by_bill=members_by_bill,
    )


def _remaining_for(
    member_id: uuid.UUID,
    agg: _DashboardAggregates,
) -> Decimal:
    """Unpaid balance for a single bill_member, clamped to zero."""
    remaining = agg.owed_by_member.get(member_id, _ZERO) - agg.paid_by_member.get(
        member_id, _ZERO
    )
    return remaining if remaining > 0 else _ZERO


def _build_overview(user_id: str, agg: _DashboardAggregates) -> DashboardOverview:
    total_bills = len(agg.bills)
    active_bills_count = sum(
        1 for b in agg.bills if b.status in ("draft", "active")
    )
    settled_bills_count = sum(1 for b in agg.bills if b.status == "settled")

    total_owed_to_you = _ZERO
    total_you_owe = _ZERO

    for bill in agg.bills:
        members = agg.members_by_bill.get(bill.id, [])
        if str(bill.owner_id) == user_id:
            for m in members:
                if str(m.user_id) != user_id:
                    total_owed_to_you += _remaining_for(m.id, agg)
        else:
            for m in members:
                if str(m.user_id) == user_id:
                    total_you_owe += _remaining_for(m.id, agg)
                    break

    return DashboardOverview(
        total_bills=total_bills,
        active_bills=active_bills_count,
        settled_bills=settled_bills_count,
        total_owed_to_you=total_owed_to_you,
        total_you_owe=total_you_owe,
    )


def _build_active_bill_summaries(
    user_id: str,
    agg: _DashboardAggregates,
) -> list[dict]:
    summaries: list[dict] = []
    for bill in agg.bills:
        if bill.status not in ("draft", "active"):
            continue

        members = agg.members_by_bill.get(bill.id, [])
        user_member = next((m for m in members if str(m.user_id) == user_id), None)

        if user_member is not None:
            your_share = agg.owed_by_member.get(user_member.id, _ZERO)
            paid = agg.paid_by_member.get(user_member.id, _ZERO)
            remaining = your_share - paid
            if remaining < 0:
                remaining = _ZERO
        else:
            your_share = _ZERO
            paid = _ZERO
            remaining = _ZERO

        summaries.append(
            ActiveBillSummary(
                id=bill.id,
                title=bill.title,
                merchant_name=bill.merchant_name,
                total=bill.total or _ZERO,
                your_share=your_share,
                paid=paid,
                remaining=remaining,
                member_count=len(members),
                status=bill.status,
                created_at=bill.created_at,
            ).model_dump()
        )

    return summaries


# ─── Endpoints ───────────────────────────────────────────────────────────────


@router.get("")
def get_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Single-round-trip payload powering the dashboard screen.

    Returns both the balance overview and the active bill list so the
    client only needs one HTTP request on cold open.
    """
    user_id = str(current_user.id)
    agg = _load_dashboard_aggregates(db, user_id)
    overview = _build_overview(user_id, agg)
    active_bills = _build_active_bill_summaries(user_id, agg)
    return success_response(
        data={
            "overview": overview.model_dump(),
            "active_bills": active_bills,
        }
    )


@router.get("/overview")
def get_overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user_id = str(current_user.id)
    agg = _load_dashboard_aggregates(db, user_id)
    overview = _build_overview(user_id, agg)
    return success_response(data=overview.model_dump())


@router.get("/active-bills")
def get_active_bills(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user_id = str(current_user.id)
    agg = _load_dashboard_aggregates(db, user_id)
    return success_response(data=_build_active_bill_summaries(user_id, agg))


@router.get("/recent-activity")
def get_recent_activity(
    current_user: User = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    mock_bill_id = uuid.uuid4()

    activities = [
        RecentActivity(
            type="bill_created",
            description="You created a new bill 'Team Dinner'",
            bill_id=mock_bill_id,
            bill_title="Team Dinner",
            amount=Decimal("156.78"),
            timestamp=now - timedelta(hours=2),
        ).model_dump(),
        RecentActivity(
            type="payment_received",
            description="Alex paid their share for 'Team Dinner'",
            bill_id=mock_bill_id,
            bill_title="Team Dinner",
            amount=Decimal("39.20"),
            timestamp=now - timedelta(hours=1),
        ).model_dump(),
        RecentActivity(
            type="member_joined",
            description="Sam joined 'Team Dinner' via invite link",
            bill_id=mock_bill_id,
            bill_title="Team Dinner",
            amount=None,
            timestamp=now - timedelta(minutes=45),
        ).model_dump(),
        RecentActivity(
            type="receipt_parsed",
            description="Receipt for 'Team Dinner' was parsed successfully",
            bill_id=mock_bill_id,
            bill_title="Team Dinner",
            amount=None,
            timestamp=now - timedelta(minutes=30),
        ).model_dump(),
        RecentActivity(
            type="payment_sent",
            description="You paid your share for 'Friday Lunch'",
            bill_id=uuid.uuid4(),
            bill_title="Friday Lunch",
            amount=Decimal("22.50"),
            timestamp=now - timedelta(days=1),
        ).model_dump(),
    ]
    return success_response(data=activities)


@router.get("/outstanding-balance")
def get_outstanding_balance(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Legacy endpoint. Kept for back-compat — prefer `/dashboard`."""
    user_id = str(current_user.id)
    agg = _load_dashboard_aggregates(db, user_id)
    overview = _build_overview(user_id, agg)
    return success_response(
        data={
            "total_you_owe": overview.total_you_owe,
            "total_owed_to_you": overview.total_owed_to_you,
            "net_balance": overview.total_owed_to_you - overview.total_you_owe,
        }
    )
