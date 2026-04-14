"""Create pending payments + send payment-request SMS when splits are assigned."""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.bill import Bill
from app.models.bill_member import BillMember
from app.models.payment import Payment
from app.models.user import User
from app.services.calculation_service import CalculationService
from app.services.sms_service import send_sms

logger = logging.getLogger(__name__)


def _money_str(amount: Decimal, currency: str) -> str:
    if currency == "USD":
        return f"${amount.quantize(Decimal('0.01')):,.2f}"
    return f"{amount.quantize(Decimal('0.01'))} {currency}"


def _pay_url(token: str) -> str:
    base = settings.PUBLIC_PAYMENT_BASE_URL.rstrip("/")
    return f"{base}/pay/{token}"


class PaymentNotificationService:
    def __init__(self, db: Session):
        self.db = db

    def sync_request_sms_for_bill(self, bill_id: str, actor_user_id: str) -> dict:
        """
        Upsert pending Payment rows per member with balance due; send SMS with pay link.
        Only the bill owner may trigger (prevents member spam).
        """
        bill = self.db.query(Bill).filter(Bill.id == bill_id).first()
        if not bill:
            raise ValueError("NOT_FOUND")
        if str(bill.owner_id) != str(actor_user_id):
            raise ValueError("FORBIDDEN")

        calc = CalculationService(self.db)
        try:
            breakdown = calc.get_balance_breakdown(bill_id)
        except ValueError:
            raise ValueError("NOT_FOUND") from None

        sent = 0
        skipped = 0
        errors: list[str] = []

        for m in breakdown["members"]:
            # Host paid upfront, skip them
            if m.get("is_host"):
                continue

            remaining = Decimal(str(m["remaining"]))
            if remaining <= 0:
                continue

            member = (
                self.db.query(BillMember)
                .filter(BillMember.id == m["member_id"])
                .first()
            )
            if not member or not member.user_id:
                skipped += 1
                logger.info(
                    "Skip SMS: member %s has no linked user", m["member_id"]
                )
                continue

            user = self.db.query(User).filter(User.id == member.user_id).first()
            if not user or not user.phone:
                skipped += 1
                logger.info("Skip SMS: user has no phone for member %s", member.id)
                continue

            payment = (
                self.db.query(Payment)
                .filter(
                    Payment.bill_id == bill.id,
                    Payment.bill_member_id == member.id,
                    Payment.status == "pending",
                )
                .first()
            )

            if not payment:
                token = secrets.token_urlsafe(32)
                payment = Payment(
                    bill_id=bill.id,
                    bill_member_id=member.id,
                    user_id=user.id,
                    amount=remaining,
                    currency=bill.currency or "USD",
                    status="pending",
                    payment_link_token=token,
                )
                self.db.add(payment)
                self.db.flush()
                prev_amount: Decimal | None = None
                had_request = False
            else:
                prev_amount = payment.amount
                had_request = payment.payment_request_sent_at is not None
                if not payment.payment_link_token:
                    payment.payment_link_token = secrets.token_urlsafe(32)
                payment.amount = remaining
                payment.user_id = user.id
                self.db.flush()

            if (
                had_request
                and prev_amount is not None
                and abs(prev_amount - remaining) < Decimal("0.01")
            ):
                skipped += 1
                continue

            link = _pay_url(payment.payment_link_token or "")
            title = (bill.title or "Bill")[:80]
            body = (
                f"You owe {_money_str(remaining, bill.currency or 'USD')} for {title}. "
                f"Pay here: {link}"
            )

            try:
                result = send_sms(
                    self.db,
                    to_phone=user.phone,
                    message=body,
                    user_id=user.id,
                    payment_id=payment.id,
                    kind="payment_request",
                )
                if result.ok:
                    payment.payment_request_sent_at = datetime.now(timezone.utc)
                    sent += 1
                else:
                    errors.append(f"{user.id}:{result.error or result.status}")
            except Exception as e:
                logger.exception("payment request SMS failed")
                errors.append(str(e))

        self.db.commit()
        return {"sent": sent, "skipped": skipped, "errors": errors}
