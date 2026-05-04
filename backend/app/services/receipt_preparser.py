import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

from app.services.receipt_patterns import (
    BALANCE_DUE_RE,
    EXTRA_FEE_FUZZY_RE,
    SUBTOTAL_FUZZY_RE,
    TAX_FUZZY_RE,
    TOTAL_FUZZY_RE,
)


PRICE_RE = re.compile(r"(?<!\d)(\d+\.\d{2})(?!\d)")
IGNORE_RE = re.compile(r"\b(visa|mastercard|amex|discover|change|cash)\b", re.IGNORECASE)

# Re-exported with the old names so existing call sites inside this module
# keep reading naturally, but matching is now fuzzy (handles OCR misspellings
# like "SUBTOAL" and compound labels like "COMPLETE SUBTOTAL").
TOTAL_WORD_RE = TOTAL_FUZZY_RE
SUBTOTAL_WORD_RE = SUBTOTAL_FUZZY_RE
TAX_WORD_RE = TAX_FUZZY_RE

QTY_X_RE = re.compile(r"\b(?:x\s*(\d+)|(\d+)\s*x)\b", re.IGNORECASE)  # x2 / 2x / x 2
QTY_AT_RE = re.compile(r"\b(\d+)\s*@\s*(\d+\.\d{2})\b", re.IGNORECASE)  # 2 @ 5.99


def _to_decimal(value: str) -> Decimal | None:
    try:
        return Decimal(value)
    except (InvalidOperation, ValueError):
        return None


def _row_has_price(row: list[str]) -> bool:
    return any(PRICE_RE.search(token) for token in row)


def _extract_price_from_row(row: list[str]) -> Decimal | None:
    for token in reversed(row):
        m = PRICE_RE.search(token)
        if m:
            return _to_decimal(m.group(1))
    return None


def _is_totals_row(row_text: str) -> bool:
    return bool(
        TOTAL_WORD_RE.search(row_text)
        or SUBTOTAL_WORD_RE.search(row_text)
        or TAX_WORD_RE.search(row_text)
        or BALANCE_DUE_RE.search(row_text)
        or EXTRA_FEE_FUZZY_RE.search(row_text)
    )


def _extract_quantity_and_unit(row_text: str) -> tuple[int | None, Decimal | None]:
    m_at = QTY_AT_RE.search(row_text)
    if m_at:
        qty = int(m_at.group(1))
        unit = _to_decimal(m_at.group(2))
        return (qty if qty > 0 else None), unit

    m_x = QTY_X_RE.search(row_text)
    if m_x:
        qty = int(m_x.group(1) or m_x.group(2))
        return (qty if qty > 0 else None), None

    return None, None


def _merge_multiline_rows(rows: list[list[str]]) -> list[list[str]]:
    merged: list[list[str]] = []
    i = 0
    while i < len(rows):
        row = rows[i]
        if not row:
            i += 1
            continue

        if not _row_has_price(row) and i + 1 < len(rows):
            nxt = rows[i + 1]
            if nxt and _row_has_price(nxt):
                merged.append([*row, *nxt])
                i += 2
                continue

        merged.append(row)
        i += 1
    return merged


@dataclass(frozen=True)
class PreparsedItem:
    name: str
    quantity: int
    unit_price: Decimal | None
    total_price: Decimal
    modifiers: list[str]


def parse_structured_rows(rows: list[list[str]]) -> dict:
    """
    Deterministic pre-parser over structured OCR rows.
    Returns:
      {
        "items": [
          {"name": str, "quantity": int, "unit_price": float|None, "total_price": float, "modifiers": list[str]},
          ...
        ],
        "totals": {"subtotal": float|None, "tax": float|None, "total": float|None},
        "confidence": float
      }
    """
    rows = [list(map(str, r)) for r in (rows or [])]
    rows = _merge_multiline_rows(rows)

    items: list[PreparsedItem] = []
    subtotal: Decimal | None = None
    tax: Decimal | None = None
    extra_fees: Decimal | None = None
    total: Decimal | None = None

    total_rows = 0
    parsed_item_rows = 0

    for row in rows:
        if not row:
            continue
        total_rows += 1
        row_text = " ".join(row).strip()
        if not row_text:
            continue

        if IGNORE_RE.search(row_text) and not _is_totals_row(row_text):
            continue

        price = _extract_price_from_row(row)
        if _is_totals_row(row_text):
            if price is None:
                continue
            # Order matters: check SUBTOTAL before TOTAL because `subtotal`
            # also matches the fuzzy `total` regex. Same for BALANCE_DUE —
            # "balance due" shouldn't overwrite an already-captured subtotal.
            if TAX_WORD_RE.search(row_text):
                tax = price
            elif EXTRA_FEE_FUZZY_RE.search(row_text):
                extra_fees = (extra_fees or Decimal("0.00")) + price
            elif SUBTOTAL_WORD_RE.search(row_text):
                subtotal = price
            elif BALANCE_DUE_RE.search(row_text):
                # "Balance due" / "amount due" / "pay this amount" are how
                # many receipts print the final total. Map them to `total`
                # if we haven't already seen an explicit TOTAL row.
                if total is None:
                    total = price
            elif TOTAL_WORD_RE.search(row_text):
                total = price
            continue

        if price is None:
            continue

        qty, unit = _extract_quantity_and_unit(row_text)
        if qty is None:
            qty = 1

        line_total = price
        if unit is not None and qty > 0:
            computed = (unit * Decimal(qty)).quantize(Decimal("0.01"))
            line_total = computed

        name_tokens = []
        for tok in row:
            if PRICE_RE.search(tok):
                continue
            name_tokens.append(tok)
        name = " ".join(name_tokens).strip(" -:")
        if not name:
            continue

        inferred_unit = (
            unit.quantize(Decimal("0.01"))
            if unit is not None
            else (line_total / Decimal(qty)).quantize(Decimal("0.01")) if qty > 0 else None
        )
        items.append(
            PreparsedItem(
                name=name,
                quantity=qty,
                unit_price=inferred_unit,
                total_price=line_total,
                modifiers=[],
            )
        )
        parsed_item_rows += 1

    sum_items = sum((it.total_price for it in items), Decimal("0.00")).quantize(Decimal("0.01"))
    if subtotal is None and sum_items > 0:
        subtotal = sum_items

    totals_available = (
        int(subtotal is not None)
        + int(tax is not None)
        + int(total is not None)
        + int(extra_fees is not None and extra_fees > 0)
    )
    coverage = (parsed_item_rows / max(total_rows, 1)) if total_rows else 0.0

    consistency = 0.0
    extras = extra_fees or Decimal("0.00")
    if subtotal is not None and tax is not None and total is not None:
        expected = (subtotal + tax + extras).quantize(Decimal("0.01"))
        diff = abs(expected - total)
        consistency = 1.0 if diff <= Decimal("0.02") else 0.0
    elif subtotal is not None and total is not None:
        diff = abs(subtotal - total)
        consistency = 1.0 if diff <= Decimal("0.02") else 0.2
    else:
        consistency = 0.2 if totals_available >= 1 else 0.0

    # Confidence heuristic: prioritize totals consistency, then row coverage, then having totals at all.
    confidence = min(
        1.0,
        (0.55 * consistency) + (0.30 * coverage) + (0.15 * (totals_available / 4.0)),
    )

    return {
        "items": [
            {
                "name": it.name,
                "quantity": it.quantity,
                "unit_price": float(it.unit_price) if it.unit_price is not None else None,
                "total_price": float(it.total_price),
                "modifiers": it.modifiers,
            }
            for it in items
        ],
        "totals": {
            "subtotal": float(subtotal) if subtotal is not None else None,
            "tax": float(tax) if tax is not None else None,
            "receipt_extra_fees": float(extra_fees) if extra_fees is not None else None,
            "total": float(total) if total is not None else None,
        },
        "confidence": float(confidence),
    }

