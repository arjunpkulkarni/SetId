"""Gate Stripe checkout until the host explicitly allows guest payments."""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.bill import Bill
from app.services.calculation_service import CalculationService

ASSIGNMENT_TOLERANCE = Decimal("0.02")


def bill_allows_guest_payment(bill: Bill | None) -> bool:
    if not bill:
        return False
    return bool(getattr(bill, "guest_pay_unlocked", True))


def assert_guest_payment_allowed(bill: Bill | None) -> None:
    if not bill_allows_guest_payment(bill):
        raise ValueError("GUEST_PAY_LOCKED")


def validate_unlock_assignments(db: Session, bill: Bill, *, force: bool) -> None:
    """Require receipt items to be fully assigned before unlock (unless force)."""
    if force:
        return
    subtotal = bill.subtotal or Decimal("0")
    if subtotal <= 0:
        return
    calc = CalculationService(db)
    try:
        breakdown = calc.get_balance_breakdown(str(bill.id))
    except ValueError:
        return
    total_assigned = sum((mb["subtotal"] for mb in breakdown["members"]), Decimal("0"))
    unassigned = subtotal - total_assigned
    if unassigned > ASSIGNMENT_TOLERANCE:
        raise ValueError("ASSIGNMENTS_INCOMPLETE")
