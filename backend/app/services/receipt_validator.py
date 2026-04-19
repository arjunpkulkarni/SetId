import re
from decimal import Decimal


MONEY_QUANTIZE = Decimal("0.01")
TOLERANCE = Decimal("0.02")
PRICE_RE = re.compile(r"(?<!\d)\d+\.\d{2}(?!\d)")


def _to_decimal(value) -> Decimal | None:
    if value in (None, ""):
        return None
    return Decimal(str(value)).quantize(MONEY_QUANTIZE)


def _quantize(value: Decimal) -> Decimal:
    return value.quantize(MONEY_QUANTIZE)


def validate_parsed_receipt(
    *,
    items: list[dict],
    subtotal,
    tax,
    total,
    llm_confidence,
    rows: list[list[str]] | None,
) -> dict:
    warnings: list[str] = []
    normalized_items: list[dict] = []
    rows = rows or []

    subtotal_dec = _to_decimal(subtotal)
    tax_dec = _to_decimal(tax) or Decimal("0.00")
    total_dec = _to_decimal(total)

    row_lookup = {" ".join(row).strip().lower(): row for row in rows if row}

    items_sum = Decimal("0.00")
    for item in items:
        total_price = _to_decimal(item.get("total_price"))
        if total_price is None:
            continue
        items_sum += total_price

        name = " ".join(str(item.get("name", "")).split()).strip()
        quantity_value = _to_decimal(item.get("quantity")) or Decimal("1.00")
        item_row = row_lookup.get(name.lower())

        price_score = 0.3 if PRICE_RE.search(f"{total_price:.2f}") else 0.0
        alignment_score = 0.3 if item_row else 0.0
        llm_score = 0.4 * float(llm_confidence or 0.0)
        item_confidence = round(min(1.0, price_score + alignment_score + llm_score), 2)

        normalized_items.append(
            {
                "name": name,
                "quantity": quantity_value,
                "unit_price": _to_decimal(item.get("unit_price")),
                "total_price": total_price,
                "modifiers": item.get("modifiers", []),
                "confidence": item_confidence,
            }
        )

    items_sum = _quantize(items_sum)
    if subtotal_dec is None:
        subtotal_dec = items_sum
        warnings.append("Subtotal derived from items")
    elif abs(items_sum - subtotal_dec) > TOLERANCE:
        warnings.append("Mismatch between subtotal and sum of items")

    if total_dec is None:
        total_dec = _quantize(subtotal_dec + tax_dec)
        warnings.append("Total derived from subtotal and tax")
    elif abs(_quantize(subtotal_dec + tax_dec) - total_dec) > TOLERANCE:
        warnings.append("Mismatch between total and computed sum")

    overall_confidence = 0.0
    if normalized_items:
        avg_item_confidence = sum(item["confidence"] for item in normalized_items) / len(normalized_items)
        overall_confidence = round(avg_item_confidence - (0.05 * len(warnings)), 2)
        overall_confidence = max(0.0, min(1.0, overall_confidence))
    else:
        overall_confidence = max(0.0, min(1.0, round(float(llm_confidence or 0.0), 2)))

    return {
        "items": normalized_items,
        "subtotal": subtotal_dec,
        "tax": tax_dec,
        "total": total_dec,
        "overall_confidence": overall_confidence,
        "warnings": warnings,
    }
