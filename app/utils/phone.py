"""E.164 validation and formatting."""

import phonenumbers
from phonenumbers import NumberParseException, PhoneNumberFormat


def normalize_to_e164(phone: str, default_region: str = "US") -> str:
    """
    Parse and validate phone, return E.164 (e.g. +15551234567).
    Raises ValueError if invalid.
    """
    raw = phone.strip()
    if not raw:
        raise ValueError("empty")
    try:
        parsed = phonenumbers.parse(raw, default_region)
    except NumberParseException as e:
        raise ValueError("invalid") from e
    if not phonenumbers.is_valid_number(parsed):
        raise ValueError("invalid")
    return phonenumbers.format_number(parsed, PhoneNumberFormat.E164)
