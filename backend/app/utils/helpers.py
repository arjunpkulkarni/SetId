import secrets
from decimal import Decimal


def generate_invite_token() -> str:
    return secrets.token_urlsafe(32)


def cents_to_dollars(cents: int) -> Decimal:
    return Decimal(cents) / 100


def dollars_to_cents(dollars: Decimal) -> int:
    return int(dollars * 100)
