"""Shared bill authorization helpers for route handlers."""

from sqlalchemy.orm import Session

from app.models.bill import Bill
from app.models.bill_member import BillMember


def require_bill_owner(db: Session, bill_id: str, user_id: str) -> Bill:
    bill = db.query(Bill).filter(Bill.id == bill_id).first()
    if not bill:
        raise ValueError("NOT_FOUND")
    if str(bill.owner_id) != user_id:
        raise ValueError("FORBIDDEN")
    return bill


def require_bill_participant(db: Session, bill_id: str, user_id: str) -> Bill:
    bill = db.query(Bill).filter(Bill.id == bill_id).first()
    if not bill:
        raise ValueError("NOT_FOUND")

    if str(bill.owner_id) == user_id:
        return bill

    is_member = (
        db.query(BillMember)
        .filter(BillMember.bill_id == bill_id, BillMember.user_id == user_id)
        .first()
    )
    if not is_member:
        raise ValueError("FORBIDDEN")
    return bill
