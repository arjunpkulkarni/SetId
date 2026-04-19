"""SMS OTP via Twilio Verify API, with optional dev in-memory fallback."""

from __future__ import annotations

import logging
import secrets
import time
from typing import Literal

from app.core.config import settings

logger = logging.getLogger(__name__)

# phone E.164 -> (code, expires_at_unix)
_dev_otp_store: dict[str, tuple[str, float]] = {}
_DEV_OTP_TTL_SEC = 600
_DEV_CODE_LENGTH = 6

_CONFIG_MSG = (
    "SMS verification is not configured. Set TWILIO_* credentials, "
    "or enable OTP_DEV_MODE=true for local development only."
)


def _twilio_configured() -> bool:
    return bool(
        settings.TWILIO_ACCOUNT_SID
        and settings.TWILIO_AUTH_TOKEN
        and settings.TWILIO_VERIFY_SERVICE_SID
    )


def otp_uses_dev_store() -> bool:
    """True when OTP is not sent via SMS (in-memory code + server log only)."""
    return not _twilio_configured() and settings.OTP_DEV_MODE


def send_otp(phone_e164: str) -> None:
    """Send OTP via Twilio Verify or dev store."""
    if _twilio_configured():
        from twilio.rest import Client

        client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
        try:
            client.verify.v2.services(settings.TWILIO_VERIFY_SERVICE_SID).verifications.create(
                to=phone_e164,
                channel="sms",
            )
        except Exception as e:
            logger.exception("Twilio send OTP failed")
            raise OtpProviderError("PROVIDER_ERROR", "Could not send verification code") from e
        return

    if settings.OTP_DEV_MODE:
        code = "".join(str(secrets.randbelow(10)) for _ in range(_DEV_CODE_LENGTH))
        expires = time.time() + _DEV_OTP_TTL_SEC
        _dev_otp_store[phone_e164] = (code, expires)
        logger.warning(
            "OTP dev mode: SMS not sent; use code %s for %s (expires in %ss)",
            code,
            phone_e164,
            _DEV_OTP_TTL_SEC,
        )
        return

    raise OtpProviderError("CONFIG_ERROR", _CONFIG_MSG)


def verify_otp(phone_e164: str, code: str) -> Literal["approved", "invalid", "expired"]:
    """Verify OTP. Returns status category for error mapping."""
    if _twilio_configured():
        from twilio.base.exceptions import TwilioRestException
        from twilio.rest import Client

        client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
        try:
            check = client.verify.v2.services(
                settings.TWILIO_VERIFY_SERVICE_SID
            ).verification_checks.create(to=phone_e164, code=code.strip())
        except TwilioRestException as e:
            logger.warning("Twilio verify error: %s", e)
            if e.status == 404 or (e.msg and "expired" in str(e.msg).lower()):
                return "expired"
            return "invalid"
        except Exception as e:
            logger.exception("Twilio verify failed")
            raise OtpProviderError("PROVIDER_ERROR", "Verification failed") from e

        if check.status == "approved":
            return "approved"
        if check.status in ("pending", "denied"):
            return "invalid"
        return "invalid"

    if settings.OTP_DEV_MODE:
        entry = _dev_otp_store.get(phone_e164)
        if not entry:
            return "expired"
        stored, exp = entry
        if time.time() > exp:
            del _dev_otp_store[phone_e164]
            return "expired"
        if stored != code.strip():
            return "invalid"
        del _dev_otp_store[phone_e164]
        return "approved"

    raise OtpProviderError("CONFIG_ERROR", _CONFIG_MSG)


class OtpProviderError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)
