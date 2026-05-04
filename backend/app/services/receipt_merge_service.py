"""Merge per-image receipt parse results (concatenate, dedupe, totals)."""

from __future__ import annotations

from decimal import Decimal
from difflib import SequenceMatcher
from typing import Any

from pydantic import ValidationError

from app.services.receipt_parser_service import CleanupReceiptItem, CleanupReceiptPayload

MONEY_Q = Decimal("0.01")
SIMILARITY_THRESHOLD = 0.90
PRICE_TOL = Decimal("0.02")


def _norm_name(name: str) -> str:
    return " ".join(name.split()).strip().lower()


def _price_eq(a: Decimal | None, b: Decimal | None) -> bool:
    if a is None or b is None:
        return False
    return abs(a - b) <= PRICE_TOL


def _similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def _to_decimal(v: Any) -> Decimal | None:
    if v is None:
        return None
    try:
        return Decimal(str(v)).quantize(MONEY_Q)
    except Exception:
        return None


def merge_intermediate_parses(
    intermediates: list[dict[str, Any]],
    *,
    merge_warnings: list[str] | None = None,
) -> tuple[CleanupReceiptPayload, list[str]]:
    """
    intermediates: each dict has keys:
      items (list of dicts), subtotal, tax, receipt_extra_fees, tip, total,
      merchant_name, confidence, source_image_index
    Returns merged CleanupReceiptPayload and additional warnings.
    """
    merge_warnings = merge_warnings if merge_warnings is not None else []
    merged_cleanup_items: list[CleanupReceiptItem] = []

    for inter in intermediates:
        idx = int(inter.get("source_image_index", 0))
        for raw in inter.get("items") or []:
            try:
                it = CleanupReceiptItem.model_validate(
                    {
                        "name": raw.get("name", ""),
                        "quantity": raw.get("quantity", 1),
                        "unit_price": raw.get("unit_price"),
                        "total_price": raw.get("total_price"),
                        "modifiers": raw.get("modifiers") or [],
                    }
                )
            except ValidationError:
                continue

            norm = _norm_name(it.name)
            dup = False
            for existing in merged_cleanup_items:
                ex_norm = _norm_name(existing.name)
                sim = _similarity(norm, ex_norm)
                if sim >= SIMILARITY_THRESHOLD and _price_eq(
                    it.total_price.quantize(MONEY_Q),
                    existing.total_price.quantize(MONEY_Q),
                ):
                    dup = True
                    break
            if not dup:
                merged_cleanup_items.append(it)

    last = intermediates[-1] if intermediates else {}
    merchant = last.get("merchant_name")
    items_sum = sum((it.total_price for it in merged_cleanup_items), Decimal("0.00")).quantize(MONEY_Q)

    # Prefer explicit footer totals from the last image; otherwise derive from merged line items.
    subtotal = _to_decimal(last.get("subtotal"))
    tax = _to_decimal(last.get("tax"))
    extra_fees = _to_decimal(last.get("receipt_extra_fees"))
    tip = _to_decimal(last.get("tip"))
    total = _to_decimal(last.get("total"))
    if subtotal is None:
        subtotal = items_sum
        merge_warnings.append("Subtotal derived from merged items")
    if tax is None:
        tax = Decimal("0.00")
    if extra_fees is None:
        extra_fees = Decimal("0.00")
    if tip is None:
        tip = Decimal("0.00")
    if total is None:
        total = (subtotal + tax + extra_fees + tip).quantize(MONEY_Q)
        merge_warnings.append(
            "Total derived from merged subtotal, tax, receipt extra fees, and tip"
        )

    confidences: list[Decimal] = []
    for inter in intermediates:
        c = _to_decimal(inter.get("confidence"))
        if c is not None:
            confidences.append(c)
    avg_conf = (
        sum(confidences, Decimal("0")) / Decimal(len(confidences))
        if confidences
        else Decimal("0")
    )
    if avg_conf > Decimal("1"):
        avg_conf = Decimal("1")

    payload = CleanupReceiptPayload.model_validate(
        {
            "merchant_name": merchant,
            "subtotal": float(subtotal) if subtotal is not None else None,
            "tax": float(tax) if tax is not None else None,
            "receipt_extra_fees": float(extra_fees) if extra_fees is not None else None,
            "tip": float(tip) if tip is not None else None,
            "total": float(total) if total is not None else None,
            "items": [it.model_dump() for it in merged_cleanup_items],
            "confidence": float(avg_conf),
        }
    )
    return payload, merge_warnings
