import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.models.bill import Bill
from app.models.bill_member import BillMember
from app.models.item_assignment import ItemAssignment
from app.models.payment import Payment
from app.core.response import success_response, error_response
from app.schemas.dashboard import DashboardOverview, ActiveBillSummary, RecentActivity

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/overview")
def get_overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user_id = str(current_user.id)

    # All bills where user is owner or member
    member_bill_ids = (
        db.query(BillMember.bill_id)
        .filter(BillMember.user_id == user_id)
        .subquery()
    )
    all_bills = (
        db.query(Bill)
        .filter(
            (Bill.owner_id == user_id) | Bill.id.in_(member_bill_ids)
        )
        .all()
    )

    total_bills = len(all_bills)
    active_bills = sum(1 for b in all_bills if b.status in ("draft", "active"))
    settled_bills = sum(1 for b in all_bills if b.status == "settled")

    # Calculate total_owed_to_you: bills where user is owner, sum of other members' unpaid balances
    total_owed_to_you = Decimal("0")
    for bill in all_bills:
        if str(bill.owner_id) == user_id:
            members = (
                db.query(BillMember)
                .filter(BillMember.bill_id == bill.id, BillMember.user_id != user_id)
                .all()
            )
            for member in members:
                owed = sum(
                    (a.amount_owed for a in db.query(ItemAssignment)
                     .filter(ItemAssignment.bill_member_id == member.id).all()),
                    Decimal("0"),
                )
                paid = sum(
                    (p.amount for p in db.query(Payment)
                     .filter(Payment.bill_member_id == member.id, Payment.status == "succeeded").all()),
                    Decimal("0"),
                )
                remaining = owed - paid
                if remaining > 0:
                    total_owed_to_you += remaining

    # Calculate total_you_owe: bills where user is member (not owner), sum of user's unpaid balance
    total_you_owe = Decimal("0")
    for bill in all_bills:
        if str(bill.owner_id) != user_id:
            user_member = (
                db.query(BillMember)
                .filter(BillMember.bill_id == bill.id, BillMember.user_id == user_id)
                .first()
            )
            if user_member:
                owed = sum(
                    (a.amount_owed for a in db.query(ItemAssignment)
                     .filter(ItemAssignment.bill_member_id == user_member.id).all()),
                    Decimal("0"),
                )
                paid = sum(
                    (p.amount for p in db.query(Payment)
                     .filter(Payment.bill_member_id == user_member.id, Payment.status == "succeeded").all()),
                    Decimal("0"),
                )
                remaining = owed - paid
                if remaining > 0:
                    total_you_owe += remaining

    overview = DashboardOverview(
        total_bills=total_bills,
        active_bills=active_bills,
        settled_bills=settled_bills,
        total_owed_to_you=total_owed_to_you,
        total_you_owe=total_you_owe,
    )
    return success_response(data=overview.model_dump())


@router.get("/active-bills")
def get_active_bills(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user_id = str(current_user.id)

    member_bill_ids = (
        db.query(BillMember.bill_id)
        .filter(BillMember.user_id == user_id)
        .subquery()
    )
    active_bills = (
        db.query(Bill)
        .filter(
            (Bill.owner_id == user_id) | Bill.id.in_(member_bill_ids),
            Bill.status.in_(["draft", "active"]),
        )
        .order_by(Bill.created_at.desc())
        .all()
    )

    summaries = []
    for bill in active_bills:
        members = (
            db.query(BillMember)
            .filter(BillMember.bill_id == bill.id)
            .all()
        )
        member_count = len(members)

        # Find user's member record for this bill
        user_member = next(
            (m for m in members if str(m.user_id) == user_id), None
        )

        your_share = Decimal("0")
        paid = Decimal("0")
        if user_member:
            your_share = sum(
                (a.amount_owed for a in db.query(ItemAssignment)
                 .filter(ItemAssignment.bill_member_id == user_member.id).all()),
                Decimal("0"),
            )
            paid = sum(
                (p.amount for p in db.query(Payment)
                 .filter(
                    Payment.bill_member_id == user_member.id,
                    Payment.status == "succeeded",
                ).all()),
                Decimal("0"),
            )

        remaining = your_share - paid
        if remaining < 0:
            remaining = Decimal("0")

        summaries.append(
            ActiveBillSummary(
                id=bill.id,
                title=bill.title,
                merchant_name=bill.merchant_name,
                total=bill.total or Decimal("0"),
                your_share=your_share,
                paid=paid,
                remaining=remaining,
                member_count=member_count,
                status=bill.status,
                created_at=bill.created_at,
            ).model_dump()
        )

    return success_response(data=summaries)


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
    user_id = str(current_user.id)

    member_bill_ids = (
        db.query(BillMember.bill_id)
        .filter(BillMember.user_id == user_id)
        .subquery()
    )
    all_bills = (
        db.query(Bill)
        .filter(
            (Bill.owner_id == user_id) | Bill.id.in_(member_bill_ids)
        )
        .all()
    )

    total_you_owe = Decimal("0")
    total_owed_to_you = Decimal("0")

    for bill in all_bills:
        if str(bill.owner_id) != user_id:
            # User is a member (not owner) — calculate what they owe
            user_member = (
                db.query(BillMember)
                .filter(BillMember.bill_id == bill.id, BillMember.user_id == user_id)
                .first()
            )
            if user_member:
                owed = sum(
                    (a.amount_owed for a in db.query(ItemAssignment)
                     .filter(ItemAssignment.bill_member_id == user_member.id).all()),
                    Decimal("0"),
                )
                paid = sum(
                    (p.amount for p in db.query(Payment)
                     .filter(
                        Payment.bill_member_id == user_member.id,
                        Payment.status == "succeeded",
                    ).all()),
                    Decimal("0"),
                )
                remaining = owed - paid
                if remaining > 0:
                    total_you_owe += remaining
        else:
            # User is the owner — calculate what others owe them
            other_members = (
                db.query(BillMember)
                .filter(BillMember.bill_id == bill.id, BillMember.user_id != user_id)
                .all()
            )
            for member in other_members:
                owed = sum(
                    (a.amount_owed for a in db.query(ItemAssignment)
                     .filter(ItemAssignment.bill_member_id == member.id).all()),
                    Decimal("0"),
                )
                paid = sum(
                    (p.amount for p in db.query(Payment)
                     .filter(
                        Payment.bill_member_id == member.id,
                        Payment.status == "succeeded",
                    ).all()),
                    Decimal("0"),
                )
                remaining = owed - paid
                if remaining > 0:
                    total_owed_to_you += remaining

    return success_response(data={
        "total_you_owe": total_you_owe,
        "total_owed_to_you": total_owed_to_you,
        "net_balance": total_owed_to_you - total_you_owe,
    })
