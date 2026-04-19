"""Twilio Programmable SMS with retries and persistence (SmsLog)."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import TYPE_CHECKING, Literal

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.sms_log import SmsLog
from app.utils.phone_format import normalize_e164

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


class SmsSendResult:
    def __init__(
        self,
        ok: bool,
        status: Literal["sent", "failed", "skipped"],
        provider_sid: str | None = None,
        error: str | None = None,
    ):
        self.ok = ok
        self.status = status
        self.provider_sid = provider_sid
        self.error = error


def _twilio_ready() -> bool:
    return bool(
        settings.TWILIO_ACCOUNT_SID
        and settings.TWILIO_AUTH_TOKEN
        and settings.TWILIO_PHONE_NUMBER
    )


def _send_twilio_sync(to_e164: str, body: str) -> SmsSendResult:
    from twilio.base.exceptions import TwilioRestException
    from twilio.rest import Client

    client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
    try:
        msg = client.messages.create(
            to=to_e164,
            from_=settings.TWILIO_PHONE_NUMBER,
            body=body,
        )
        logger.info("SMS sent to %s sid=%s", to_e164[:6] + "***", msg.sid)
        return SmsSendResult(True, "sent", provider_sid=msg.sid)
    except TwilioRestException as e:
        err = f"Twilio {e.code}: {e.msg}"
        logger.warning("Twilio SMS failed: %s", err)
        return SmsSendResult(False, "failed", error=err)
    except Exception as e:
        err = str(e)
        logger.exception("Twilio SMS unexpected error")
        return SmsSendResult(False, "failed", error=err)


def send_sms(
    db: Session,
    *,
    to_phone: str,
    message: str,
    user_id: uuid.UUID | str | None,
    payment_id: uuid.UUID | str | None,
    kind: Literal["payment_request", "reminder"],
) -> SmsSendResult:
    """
    Send SMS with retries, write SmsLog row.
    Sync API (call from BackgroundTasks or asyncio.to_thread).
    """
    e164 = normalize_e164(to_phone)
    if not e164:
        _log_sms(
            db,
            user_id=user_id,
            payment_id=payment_id,
            phone=(to_phone or "")[:32],
            message=message,
            kind=kind,
            status="skipped",
            provider_sid=None,
            error="INVALID_PHONE",
        )
        db.commit()
        return SmsSendResult(False, "skipped", error="INVALID_PHONE")

    if _twilio_ready():
        delay = settings.SMS_RETRY_BASE_DELAY_SEC
        last: SmsSendResult | None = None
        for attempt in range(settings.SMS_MAX_RETRIES):
            last = _send_twilio_sync(e164, message)
            if last.ok:
                _log_sms(
                    db,
                    user_id=user_id,
                    payment_id=payment_id,
                    phone=e164,
                    message=message,
                    kind=kind,
                    status="sent",
                    provider_sid=last.provider_sid,
                    error=None,
                )
                db.commit()
                return last
            if attempt < settings.SMS_MAX_RETRIES - 1:
                time.sleep(delay)
                delay *= 2

        assert last is not None
        _log_sms(
            db,
            user_id=user_id,
            payment_id=payment_id,
            phone=e164,
            message=message,
            kind=kind,
            status="failed",
            provider_sid=None,
            error=last.error,
        )
        db.commit()
        return last

    if settings.SMS_DEV_MODE:
        logger.warning(
            "SMS dev mode (Twilio not configured): would send to %s — %s",
            e164[:6] + "***",
            message[:80],
        )
        _log_sms(
            db,
            user_id=user_id,
            payment_id=payment_id,
            phone=e164,
            message=message,
            kind=kind,
            status="sent",
            provider_sid="dev_mode",
            error=None,
        )
        db.commit()
        return SmsSendResult(True, "sent", provider_sid="dev_mode")

    err = "Twilio not configured (set TWILIO_* or SMS_DEV_MODE=true)"
    logger.error(err)
    _log_sms(
        db,
        user_id=user_id,
        payment_id=payment_id,
        phone=e164,
        message=message,
        kind=kind,
        status="failed",
        provider_sid=None,
        error=err,
    )
    db.commit()
    return SmsSendResult(False, "failed", error=err)


def _log_sms(
    db: Session,
    *,
    user_id,
    payment_id,
    phone: str,
    message: str,
    kind: str,
    status: str,
    provider_sid: str | None,
    error: str | None,
) -> None:
    uid = uuid.UUID(str(user_id)) if user_id else None
    pid = uuid.UUID(str(payment_id)) if payment_id else None
    row = SmsLog(
        user_id=uid,
        payment_id=pid,
        phone=phone,
        message=message,
        kind=kind,
        status=status,
        provider_message_sid=provider_sid,
        error_message=error,
    )
    db.add(row)


async def send_sms_async(
    db: Session,
    *,
    to_phone: str,
    message: str,
    user_id: uuid.UUID | str | None,
    payment_id: uuid.UUID | str | None,
    kind: Literal["payment_request", "reminder"],
) -> SmsSendResult:
    return await asyncio.to_thread(
        send_sms,
        db,
        to_phone=to_phone,
        message=message,
        user_id=user_id,
        payment_id=payment_id,
        kind=kind,
    )
