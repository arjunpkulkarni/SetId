"""Scheduled reminders for long-pending payments (SMS)."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.payment import Payment
from app.models.user import User
from app.services.payment_notification_service import _money_str, _pay_url
from app.services.sms_service import send_sms

logger = logging.getLogger(__name__)


def run_payment_reminders(db: Session) -> dict:
    """
    Send at most one reminder per REMINDER_MIN_INTERVAL_HOURS per payment,
    only if still pending and anchor time is older than REMINDER_UNPAID_AFTER_HOURS.
    """
    now = datetime.now(timezone.utc)
    min_age = timedelta(hours=settings.REMINDER_UNPAID_AFTER_HOURS)
    min_gap = timedelta(hours=settings.REMINDER_MIN_INTERVAL_HOURS)

    payments = (
        db.query(Payment)
        .filter(Payment.status == "pending")
        .filter(Payment.payment_link_token.isnot(None))
        .all()
    )

    sent = 0
    for payment in payments:
        if payment.amount is None or payment.amount <= 0:
            continue

        if not payment.user_id:
            continue

        user = db.query(User).filter(User.id == payment.user_id).first()
        if not user or not user.phone:
            continue

        anchor = payment.payment_request_sent_at or payment.created_at
        if anchor is None:
            continue
        if anchor.tzinfo is None:
            anchor = anchor.replace(tzinfo=timezone.utc)

        if now - anchor < min_age:
            continue

        if payment.last_reminder_sent_at:
            lr = payment.last_reminder_sent_at
            if lr.tzinfo is None:
                lr = lr.replace(tzinfo=timezone.utc)
            if now - lr < min_gap:
                continue

        bill = payment.bill
        if not bill:
            continue

        link = _pay_url(payment.payment_link_token or "")
        title = (bill.title or "Bill")[:80]
        body = (
            f"Reminder: You still owe {_money_str(Decimal(str(payment.amount)), bill.currency or 'USD')} "
            f"for {title}. Pay here: {link}"
        )

        try:
            result = send_sms(
                db,
                to_phone=user.phone,
                message=body,
                user_id=user.id,
                payment_id=payment.id,
                kind="reminder",
            )
            if result.ok:
                payment.last_reminder_sent_at = now
                sent += 1
        except Exception:
            logger.exception("Reminder SMS failed for payment %s", payment.id)

    db.commit()
    return {"reminders_sent": sent}


def run_reminders_job() -> None:
    """Entry point for APScheduler / cron (opens its own DB session)."""
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        summary = run_payment_reminders(db)
        logger.info("Payment reminder job: %s", summary)
    except Exception:
        logger.exception("Payment reminder job failed")
        db.rollback()
    finally:
        db.close()
