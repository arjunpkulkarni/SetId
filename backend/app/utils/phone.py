"""E.164 validation and formatting."""

import phonenumbers
from phonenumbers import NumberParseException, PhoneNumberFormat


def normalize_to_e164(phone: str, default_region: str = "US") -> str:
    """
    Parse and validate phone, return E.164 (e.g. +15551234567).
    Raises ValueError if invalid.

    Configured test phones (``settings.TEST_PHONE_NUMBERS``) bypass
    validation and are returned verbatim. This lets operators use
    fictitious numbers (e.g. +15555550100) that ``phonenumbers`` would
    otherwise reject, while keeping real traffic fully validated.
    """
    raw = phone.strip()
    if not raw:
        raise ValueError("empty")

    # Test-login bypass: allow any operator-configured number through
    # untouched so it can match the bypass logic in otp_service.
    try:
        from app.core.config import settings
        if raw in settings.TEST_PHONE_NUMBERS:
            return raw
    except Exception:
        pass

    try:
        parsed = phonenumbers.parse(raw, default_region)
    except NumberParseException as e:
        raise ValueError("invalid") from e
    if not phonenumbers.is_valid_number(parsed):
        raise ValueError("invalid")
    return phonenumbers.format_number(parsed, PhoneNumberFormat.E164)
