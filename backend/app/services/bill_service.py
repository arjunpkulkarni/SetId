import secrets
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.bill import Bill
from app.models.bill_member import BillMember
from app.models.user import User


def _invite_url(token: str) -> str:
    base = settings.PUBLIC_PAYMENT_BASE_URL.rstrip("/")
    return f"{base}/invite/{token}"


class BillService:
    def __init__(self, db: Session):
        self.db = db

    def create_bill(
        self,
        owner_id: str,
        title: str,
        merchant_name: str | None = None,
        currency: str = "USD",
        notes: str | None = None,
    ) -> Bill:
        bill = Bill(
            title=title,
            merchant_name=merchant_name,
            currency=currency,
            notes=notes,
            owner_id=owner_id,
            guest_pay_unlocked=False,
        )
        self.db.add(bill)
        self.db.flush()

        owner = self.db.query(User).filter(User.id == owner_id).first()
        nickname = owner.full_name if owner else "Owner"

        owner_member = BillMember(
            bill_id=bill.id,
            user_id=owner_id,
            nickname=nickname,
            status="joined",
            joined_at=datetime.now(timezone.utc),
        )
        self.db.add(owner_member)
        self.db.commit()
        self.db.refresh(bill)
        return bill

    def get_user_bills(self, user_id: str, status: str | None = None) -> list[Bill]:
        member_bill_ids = (
            self.db.query(BillMember.bill_id)
            .filter(BillMember.user_id == user_id)
            .subquery()
        )

        query = self.db.query(Bill).filter(
            or_(
                Bill.owner_id == user_id,
                Bill.id.in_(member_bill_ids),
            )
        )

        if status:
            query = query.filter(Bill.status == status)

        bills = query.order_by(Bill.created_at.desc()).all()

        for bill in bills:
            # Exclude the shared invite-link placeholder from member counts.
            member_count = (
                self.db.query(BillMember)
                .filter(
                    BillMember.bill_id == bill.id,
                    BillMember.status != "invite_link",
                )
                .count()
            )
            bill.member_count = member_count  # type: ignore[attr-defined]

        return bills

    def get_bill(self, bill_id: str) -> Bill | None:
        return self.db.query(Bill).filter(Bill.id == bill_id).first()

    def update_bill(self, bill_id: str, data: dict) -> Bill:
        bill = self.db.query(Bill).filter(Bill.id == bill_id).first()
        if not bill:
            raise ValueError(f"Bill {bill_id} not found")

        for key, value in data.items():
            if hasattr(bill, key):
                setattr(bill, key, value)

        financial_fields = {"subtotal", "tax", "tip", "service_fee", "receipt_extra_fees"}
        if financial_fields.intersection(data) and "total" not in data:
            bill.total = (
                (bill.subtotal or Decimal("0.00"))
                + (bill.tax or Decimal("0.00"))
                + (bill.tip or Decimal("0.00"))
                + (bill.receipt_extra_fees or Decimal("0.00"))
                + (bill.service_fee or Decimal("0.00"))
            )

        self.db.commit()
        self.db.refresh(bill)
        return bill

    def delete_bill(self, bill_id: str) -> None:
        bill = self.db.query(Bill).filter(Bill.id == bill_id).first()
        if not bill:
            raise ValueError(f"Bill {bill_id} not found")

        self.db.delete(bill)
        self.db.commit()

    def add_member(
        self,
        bill_id: str,
        user_id: str | None = None,
        email: str | None = None,
        nickname: str = "",
    ) -> BillMember:
        if not nickname and user_id:
            user = self.db.query(User).filter(User.id == user_id).first()
            if user:
                nickname = user.full_name

        if not nickname and email:
            nickname = email.split("@")[0]

        if not nickname:
            nickname = "Guest"

        token = secrets.token_urlsafe(32)
        member = BillMember(
            bill_id=bill_id,
            user_id=user_id,
            email=email,
            nickname=nickname,
            status="invited",
            invite_token=token,
        )
        self.db.add(member)
        self.db.commit()
        self.db.refresh(member)
        return member

    def get_members(self, bill_id: str) -> list[BillMember]:
        # Exclude the shared invite-link placeholder row — it represents the
        # share link itself, not a real guest.
        return (
            self.db.query(BillMember)
            .filter(
                BillMember.bill_id == bill_id,
                BillMember.status != "invite_link",
            )
            .all()
        )

    def update_member(self, member_id: str, data: dict) -> BillMember:
        member = self.db.query(BillMember).filter(BillMember.id == member_id).first()
        if not member:
            raise ValueError(f"BillMember {member_id} not found")

        for key, value in data.items():
            if hasattr(member, key):
                setattr(member, key, value)

        self.db.commit()
        self.db.refresh(member)
        return member

    def remove_member(self, member_id: str) -> None:
        member = self.db.query(BillMember).filter(BillMember.id == member_id).first()
        if not member:
            raise ValueError(f"BillMember {member_id} not found")

        self.db.delete(member)
        self.db.commit()

    def create_invite_token(self, bill_id: str) -> tuple[str, str]:
        """Create a shareable invite link for the bill. Returns (token, invite_url)."""
        bill = self.db.query(Bill).filter(Bill.id == bill_id).first()
        if not bill:
            raise ValueError(f"Bill {bill_id} not found")

        token = secrets.token_urlsafe(32)
        placeholder = BillMember(
            bill_id=bill_id,
            nickname="(invite link)",
            status="invite_link",
            invite_token=token,
        )
        self.db.add(placeholder)
        self.db.commit()

        return token, _invite_url(token)

    def get_member_by_invite_token(self, token: str) -> BillMember | None:
        return (
            self.db.query(BillMember)
            .filter(BillMember.invite_token == token)
            .first()
        )

    def join_by_token(self, token: str, user_id: str) -> BillMember:
        member = self.get_member_by_invite_token(token)
        if not member:
            raise ValueError("Invalid invite token")

        bill_id = str(member.bill_id)

        existing = (
            self.db.query(BillMember)
            .filter(
                BillMember.bill_id == bill_id,
                BillMember.user_id == user_id,
            )
            .first()
        )
        if existing:
            if existing.status == "invited":
                existing.status = "joined"
                existing.joined_at = datetime.now(timezone.utc)
                self.db.commit()
                self.db.refresh(existing)
            return existing

        user = self.db.query(User).filter(User.id == user_id).first()
        nickname = user.full_name if user else "Guest"

        # Do NOT consume the shared invite-link placeholder here — it represents
        # the share link itself and must remain available for additional guests
        # to join through the same URL. Always mint a fresh BillMember row for
        # the authenticated joiner instead.
        new_member = BillMember(
            bill_id=bill_id,
            user_id=user_id,
            nickname=nickname,
            status="joined",
            invite_token=secrets.token_urlsafe(32),
            joined_at=datetime.now(timezone.utc),
        )
        self.db.add(new_member)
        self.db.commit()
        self.db.refresh(new_member)
        return new_member
