import re
from decimal import Decimal

from app.services.receipt_patterns import is_label_like


MONEY_QUANTIZE = Decimal("0.01")
TOLERANCE = Decimal("0.02")
PRICE_RE = re.compile(r"(?<!\d)\d+\.\d{2}(?!\d)")


def _to_decimal(value) -> Decimal | None:
    if value in (None, ""):
        return None
    return Decimal(str(value)).quantize(MONEY_QUANTIZE)


def _quantize(value: Decimal) -> Decimal:
    return value.quantize(MONEY_QUANTIZE)


def _drop_label_duplicates(
    items: list[dict],
    target_subtotal: Decimal,
) -> tuple[list[dict], list[str]]:
    """When items sum over the printed subtotal, try to find and drop summary
    labels that the LLM duplicated as items.

    Strategy: group items by identical `total_price`. For any group with 2+
    members, if at least one member has a "label-like" name (subtotal,
    complete, balance due, etc.), drop those label-y members one at a time
    until either the group shrinks to a single item OR the overall sum
    reaches `target_subtotal` within tolerance.

    This is conservative — it only drops items that both (a) share a price
    with another item and (b) look like labels. Never drops every item in a
    group.

    Returns `(new_items, notes)`. `notes` is human-readable audit trail
    appended to the validator's `warnings` array.
    """
    notes: list[str] = []
    # Group indices by price
    by_price: dict[Decimal, list[int]] = {}
    for idx, item in enumerate(items):
        price = _to_decimal(item.get("total_price"))
        if price is None:
            continue
        by_price.setdefault(price, []).append(idx)

    drop: set[int] = set()
    for price, idxs in by_price.items():
        if len(idxs) < 2:
            continue
        # Rank candidates: label-like first, then shortest name (label rows
        # are usually short — "subtotal" vs "12 oz ribeye steak").
        ranked = sorted(
            idxs,
            key=lambda i: (
                not is_label_like(items[i].get("name", "")),  # label_like first
                len((items[i].get("name") or "")),            # shorter first within each group
            ),
        )
        # Drop label-like duplicates but never ALL copies — keep the last one
        # standing even if every copy happens to look label-y.
        for cand in ranked[:-1]:
            if not is_label_like(items[cand].get("name", "")):
                # No more label-shaped duplicates to drop in this group.
                break
            drop.add(cand)
            notes.append(
                f"Dropped duplicate label row '{items[cand].get('name','')}' at ${price}"
            )
            # Short-circuit: if dropping this one already reconciles the
            # total, stop.
            remaining = sum(
                _to_decimal(items[j].get("total_price")) or Decimal("0.00")
                for j in range(len(items))
                if j not in drop
            )
            if abs(_quantize(remaining) - target_subtotal) <= TOLERANCE:
                return [it for j, it in enumerate(items) if j not in drop], notes

    new_items = [it for j, it in enumerate(items) if j not in drop]
    return new_items, notes


def validate_parsed_receipt(
    *,
    items: list[dict],
    subtotal,
    tax,
    total,
    llm_confidence,
    rows: list[list[str]] | None,
    tip=None,
) -> dict:
    warnings: list[str] = []
    normalized_items: list[dict] = []
    rows = rows or []

    subtotal_dec = _to_decimal(subtotal)
    tax_dec = _to_decimal(tax) or Decimal("0.00")
    tip_dec = _to_decimal(tip) or Decimal("0.00")
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

    # When the printed subtotal is known and the items sum OVER it, the most
    # common cause is the LLM emitting a summary label (subtotal / complete /
    # balance due) as a duplicate line item. Try to reconcile by dropping
    # label-like duplicates that share a price with a real item. If the math
    # still doesn't work we fall through and just warn, leaving the items
    # untouched.
    if subtotal_dec is not None and items_sum - subtotal_dec > TOLERANCE:
        deduped, dedupe_notes = _drop_label_duplicates(normalized_items, subtotal_dec)
        if dedupe_notes:
            new_sum = _quantize(
                sum(
                    (it["total_price"] for it in deduped),
                    Decimal("0.00"),
                )
            )
            # Only accept the dedupe if it actually improved things.
            if abs(new_sum - subtotal_dec) < abs(items_sum - subtotal_dec):
                normalized_items = deduped
                items_sum = new_sum
                warnings.extend(dedupe_notes)

    if subtotal_dec is None:
        subtotal_dec = items_sum
        warnings.append("Subtotal derived from items")
    elif abs(items_sum - subtotal_dec) > TOLERANCE:
        warnings.append("Mismatch between subtotal and sum of items")

    if total_dec is None:
        total_dec = _quantize(subtotal_dec + tax_dec + tip_dec)
        warnings.append("Total derived from subtotal, tax, and tip")
    elif abs(_quantize(subtotal_dec + tax_dec + tip_dec) - total_dec) > TOLERANCE:
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
        "tip": tip_dec,
        "total": total_dec,
        "overall_confidence": overall_confidence,
        "warnings": warnings,
    }
