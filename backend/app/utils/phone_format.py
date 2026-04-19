"""Normalize phone numbers to E.164 for Twilio."""

from __future__ import annotations

import logging

import phonenumbers
from phonenumbers import NumberParseException

logger = logging.getLogger(__name__)


def normalize_e164(phone: str, default_region: str = "US") -> str | None:
    """Return E.164 or None if invalid."""
    if not phone or not str(phone).strip():
        return None
    raw = str(phone).strip()
    try:
        parsed = phonenumbers.parse(raw, default_region if not raw.startswith("+") else None)
        if not phonenumbers.is_valid_number(parsed):
            return None
        return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
    except NumberParseException:
        logger.warning("Invalid phone number: %s", phone[:20])
        return None
