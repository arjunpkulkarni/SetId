"""Deterministic receipt pipeline tests (no Groq / external APIs)."""

from decimal import Decimal

import pytest

from app.services.receipt_item_normalizer import normalize_cleanup_payload
from app.services.receipt_merge_service import merge_intermediate_parses
from app.services.receipt_parser_service import CleanupReceiptPayload
from app.services.receipt_preparser import parse_structured_rows
from app.services.receipt_validator import validate_parsed_receipt


def test_preparser_extracts_line_items_and_totals():
    rows = [
        ["BURGER", "12.99"],
        ["FRIES", "3.99"],
        ["SUBTOTAL", "16.98"],
        ["TAX", "1.02"],
        ["TOTAL", "18.00"],
    ]
    out = parse_structured_rows(rows)
    assert len(out["items"]) >= 2
    names = {i["name"] for i in out["items"]}
    assert "BURGER" in names
    assert "FRIES" in names
    assert out["totals"]["tax"] == pytest.approx(1.02)
    assert out["totals"]["total"] == pytest.approx(18.00)
    assert 0.0 <= out["confidence"] <= 1.0


def test_validator_derives_subtotal_and_total():
    items = [
        {
            "name": "A",
            "quantity": Decimal("1"),
            "unit_price": Decimal("10.00"),
            "total_price": Decimal("10.00"),
            "modifiers": [],
        }
    ]
    out = validate_parsed_receipt(
        items=items,
        subtotal=None,
        tax=Decimal("0.50"),
        total=None,
        llm_confidence=Decimal("0.9"),
        rows=[["A", "10.00"]],
    )
    assert "Subtotal derived from items" in out["warnings"]
    assert "Total derived from subtotal and tax" in out["warnings"]
    assert out["subtotal"] == Decimal("10.00")
    assert out["total"] == Decimal("10.50")


def test_merge_intermediate_concatenates_and_dedupes():
    a = {
        "items": [
            {
                "name": "Burger",
                "quantity": 1,
                "unit_price": None,
                "total_price": 10.0,
                "modifiers": [],
            }
        ],
        "subtotal": 10.0,
        "tax": 0.5,
        "total": 10.5,
        "merchant_name": "Cafe",
        "confidence": 0.9,
        "source_image_index": 0,
    }
    b = {
        "items": [
            {
                "name": "burger",
                "quantity": 1,
                "unit_price": None,
                "total_price": 10.0,
                "modifiers": [],
            },
            {
                "name": "Fries",
                "quantity": 1,
                "unit_price": None,
                "total_price": 3.0,
                "modifiers": [],
            },
        ],
        "subtotal": 13.0,
        "tax": 0.8,
        "total": 13.8,
        "merchant_name": "Cafe",
        "confidence": 0.85,
        "source_image_index": 1,
    }
    merged, warnings = merge_intermediate_parses([a, b])
    names = [it.name for it in merged.items]
    assert names == ["Burger", "Fries"]
    assert merged.total is not None
    assert merged.merchant_name == "Cafe"
    assert isinstance(warnings, list)


def test_normalizer_dictionary_maps_abbreviation():
    cleaned = CleanupReceiptPayload.model_validate(
        {
            "merchant_name": None,
            "subtotal": None,
            "tax": None,
            "total": None,
            "items": [
                {
                    "name": "CHK SNDWCH",
                    "quantity": Decimal("1"),
                    "unit_price": None,
                    "total_price": Decimal("12.99"),
                    "modifiers": [],
                }
            ],
            "confidence": Decimal("0.5"),
        }
    )
    out = normalize_cleanup_payload(cleaned, llm_client=None)
    assert out.items[0].name == "Chicken Sandwich"

