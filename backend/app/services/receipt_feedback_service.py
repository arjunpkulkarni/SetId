"""Capture user corrections vs parsed receipt items for feedback / learning."""

from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.receipt_item_feedback import ReceiptItemFeedback

MONEY_Q = Decimal("0.01")


def _q(d: Decimal | None) -> Decimal | None:
    if d is None:
        return None
    return d.quantize(MONEY_Q)


def _changed(before: dict, after: dict) -> bool:
    for key in ("name", "quantity", "unit_price", "total_price"):
        bv, av = before.get(key), after.get(key)
        if key in ("unit_price", "total_price"):
            if _q(bv) != _q(av):  # type: ignore[arg-type]
                return True
        else:
            if bv != av:
                return True
    return False


def record_item_edit_feedback(
    db: Session,
    *,
    receipt_item_id: uuid.UUID,
    bill_id: uuid.UUID,
    user_id: uuid.UUID | None,
    source: str,
    before: dict,
    after: dict,
) -> None:
    if not _changed(before, after):
        return
    db.add(
        ReceiptItemFeedback(
            receipt_item_id=receipt_item_id,
            bill_id=bill_id,
            user_id=user_id,
            source=source,
            original_name=before.get("name"),
            corrected_name=after.get("name"),
            original_quantity=before.get("quantity"),
            corrected_quantity=after.get("quantity"),
            original_unit_price=_q(before.get("unit_price")),  # type: ignore[arg-type]
            corrected_unit_price=_q(after.get("unit_price")),  # type: ignore[arg-type]
            original_total_price=_q(before.get("total_price")),  # type: ignore[arg-type]
            corrected_total_price=_q(after.get("total_price")),  # type: ignore[arg-type]
        )
    )
