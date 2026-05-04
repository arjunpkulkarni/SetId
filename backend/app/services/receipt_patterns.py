"""
Shared regex patterns for detecting summary/label lines on receipts.

These are fuzzy on purpose — they need to tolerate OCR misspellings like
`SUBTOAL` (missing t), `TOTL`, split words (`SUB TOTAL`), hyphens
(`SUB-TOTAL`), and stylistic variants (`GRAND TOTAL`, `BALANCE DUE`).

Every regex here is used in at least two places:
  - `receipt_preparser.py` routes matching rows into the subtotal/tax/total
    fields instead of treating them as line items.
  - `receipt_parser_service.py` applies them as a defensive filter after the
    LLM cleanup step so any label that slipped through is still dropped.

Adding a new label: add the regex here once and both layers pick it up.
"""

import re


# subtotal / sub total / sub-total / subttl / subtoal / s u b t o t a l
SUBTOTAL_FUZZY_RE = re.compile(
    r"\bsub[-\s]?t+[o0]?t+[a-z]*\b",
    re.IGNORECASE,
)

# total / grand total / net total / running total / final total / totl / totai
TOTAL_FUZZY_RE = re.compile(
    r"\b(?:grand|net|running|final)?\s*tot[a-lnp-z]*\b",
    re.IGNORECASE,
)

# tax / sales tax / vat / gst / hst
TAX_FUZZY_RE = re.compile(
    r"\b(?:sales?\s+)?(?:tax|vat|gst|hst)\b",
    re.IGNORECASE,
)

# balance due / amt due / amount due / amount owed / pay this amount /
# to pay / please pay / charge / final amount
BALANCE_DUE_RE = re.compile(
    r"\b(?:balance(?:\s+due)?|amt?\s+due|amount\s+(?:due|owed)|pay\s+this\s+amount|"
    r"to\s+pay|please\s+pay|charge|final\s+amount)\b",
    re.IGNORECASE,
)

# Label-ish adjectives that appear on receipt summary rows. Too generic on
# their own (a real item could be "complete breakfast"), so only treat as
# label-positive when combined with another anchor — use `is_label_like`
# below rather than matching these alone.
SUMMARY_LABEL_ADJECTIVES_RE = re.compile(
    r"\b(?:complete|running)\b",
    re.IGNORECASE,
)


# Mandatory venue surcharges: % fee lines, service charge, facility fee, etc.
# (Discretionary tips map to `tip`, not here.)
EXTRA_FEE_FUZZY_RE = re.compile(
    r"\b(?:"
    r"\d+\s*%\s*fee|"
    r"service\s+(?:charge|fee)|"
    r"facility\s+fee|"
    r"kitchen\s+fee|"
    r"health\s+(?:fee|surcharge)|"
    r"mandatory\s+fee|"
    r"venue\s+fee|"
    r"(?:service|facility)\s+surcharge|"
    r"(?:cover|seating)\s+(?:charge|fee)|"
    r"\bsurcharge\b"
    r")\b",
    re.IGNORECASE,
)


def is_totals_row(text: str) -> bool:
    """True if `text` looks like a subtotal / tax / total / balance-due / fee row."""
    return bool(
        SUBTOTAL_FUZZY_RE.search(text)
        or TOTAL_FUZZY_RE.search(text)
        or TAX_FUZZY_RE.search(text)
        or BALANCE_DUE_RE.search(text)
        or EXTRA_FEE_FUZZY_RE.search(text)
    )


def is_label_like(name: str) -> bool:
    """True if `name` reads like a summary label rather than a purchased item.

    Used by the post-LLM dedupe pass to decide which of several same-price
    items is the "fake" one when the items_sum doesn't match the printed
    subtotal.

    Treats `complete` / `running` as label-positive because they're almost
    always summary adjectives in the context where we'd be disambiguating —
    if the LLM emitted an item literally named "complete subtotal" or just
    "complete" next to another 1:1-priced real item, it's the label.
    """
    if not name:
        return True
    return bool(
        SUBTOTAL_FUZZY_RE.search(name)
        or TOTAL_FUZZY_RE.search(name)
        or TAX_FUZZY_RE.search(name)
        or BALANCE_DUE_RE.search(name)
        or EXTRA_FEE_FUZZY_RE.search(name)
        or SUMMARY_LABEL_ADJECTIVES_RE.search(name)
    )
