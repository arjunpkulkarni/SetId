"""Deterministic receipt pipeline tests (no external LLM APIs)."""

from decimal import Decimal

import pytest

from app.core.config import Settings
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
    assert out["totals"].get("receipt_extra_fees") is None
    assert out["totals"]["total"] == pytest.approx(18.00)
    assert 0.0 <= out["confidence"] <= 1.0


def test_preparser_extracts_percentage_venue_fee_line():
    rows = [
        ["ITEM A", "60.00"],
        ["ITEM B", "43.75"],
        ["SUBTOTAL", "103.75"],
        ["16% FEE", "16.60"],
        ["STATE TAX", "11.43"],
        ["TOTAL DUE", "131.78"],
    ]
    out = parse_structured_rows(rows)
    assert out["totals"]["subtotal"] == pytest.approx(103.75)
    assert out["totals"]["receipt_extra_fees"] == pytest.approx(16.60)
    assert out["totals"]["tax"] == pytest.approx(11.43)
    assert out["totals"]["total"] == pytest.approx(131.78)


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
    assert "Total derived from subtotal, tax, tip, and receipt extra fees" in out["warnings"]
    assert out["subtotal"] == Decimal("10.00")
    assert out["total"] == Decimal("10.50")
    assert out["receipt_extra_fees"] == Decimal("0.00")


def test_validator_includes_receipt_extra_fees_in_total_math():
    items = [
        {
            "name": "A",
            "quantity": Decimal("1"),
            "unit_price": Decimal("100.00"),
            "total_price": Decimal("100.00"),
            "modifiers": [],
        }
    ]
    out = validate_parsed_receipt(
        items=items,
        subtotal=Decimal("100.00"),
        tax=Decimal("10.00"),
        receipt_extra_fees=Decimal("16.60"),
        total=Decimal("131.78"),
        tip=Decimal("5.18"),
        llm_confidence=Decimal("0.9"),
        rows=[],
    )
    assert out["receipt_extra_fees"] == Decimal("16.60")
    assert out["total"] == Decimal("131.78")


def test_validator_clears_spurious_tip_when_total_matches_subtotal_plus_tax_only():
    """LLM sometimes emits tip=1.00 though the receipt total is only subtotal + tax."""
    items = [
        {
            "name": "Burger",
            "quantity": Decimal("1"),
            "unit_price": Decimal("10.00"),
            "total_price": Decimal("10.00"),
            "modifiers": [],
        },
    ]
    out = validate_parsed_receipt(
        items=items,
        subtotal=Decimal("10.00"),
        tax=Decimal("0.99"),
        total=Decimal("10.99"),
        tip=Decimal("1.00"),
        llm_confidence=Decimal("0.9"),
        rows=[],
    )
    assert out["tip"] == Decimal("0.00")
    assert "Tip omitted" in " ".join(out["warnings"])


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
    assert merged.receipt_extra_fees in (None, Decimal("0.00"))
    assert isinstance(warnings, list)


def test_merge_intermediate_carries_receipt_extra_fees_from_last_image():
    a = {
        "items": [{"name": "X", "quantity": 1, "unit_price": None, "total_price": 50.0, "modifiers": []}],
        "subtotal": 50.0,
        "tax": 5.0,
        "receipt_extra_fees": 8.0,
        "total": 63.0,
        "merchant_name": "Venue",
        "confidence": 0.9,
        "source_image_index": 0,
    }
    b = {
        "items": [
            {"name": "X", "quantity": 1, "unit_price": None, "total_price": 50.0, "modifiers": []},
            {"name": "Y", "quantity": 1, "unit_price": None, "total_price": 20.0, "modifiers": []},
        ],
        "subtotal": 70.0,
        "tax": 7.0,
        "receipt_extra_fees": 10.0,
        "total": 87.0,
        "merchant_name": "Venue",
        "confidence": 0.85,
        "source_image_index": 1,
    }
    merged, _warnings = merge_intermediate_parses([a, b])
    assert merged.receipt_extra_fees == Decimal("10.00")
    assert merged.total == Decimal("87.00")


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


def test_receipt_ai_settings_prefer_openai_envs():
    settings_obj = Settings(
        _env_file=None,
        OPENAI_API_KEY="sk-openai-test",
        OPENAI_RECEIPT_VISION_MODEL="gpt-4.1",
        OPENAI_RECEIPT_CLEANUP_MODEL="gpt-4.1-mini",
        GROQ_API_KEY="gsk-legacy-test",
    )

    assert settings_obj.receipt_ai_configured is True
    assert settings_obj.receipt_ai_uses_openai is True
    assert settings_obj.receipt_ai_api_key == "sk-openai-test"
    assert settings_obj.receipt_ai_base_url is None
    assert settings_obj.receipt_ai_vision_model == "gpt-4.1"
    assert settings_obj.receipt_ai_cleanup_model == "gpt-4.1-mini"


def test_receipt_ai_settings_upgrade_legacy_key_slot_when_it_contains_openai_key():
    settings_obj = Settings(
        _env_file=None,
        GROQ_API_KEY="sk-openai-test",
        GROQ_BASE_URL="https://api.groq.com/openai/v1",
    )

    assert settings_obj.receipt_ai_uses_openai is True
    assert settings_obj.receipt_ai_api_key == "sk-openai-test"
    assert settings_obj.receipt_ai_base_url is None
    assert settings_obj.receipt_ai_vision_model == "gpt-4.1"
    assert settings_obj.receipt_ai_cleanup_model == "gpt-4.1-mini"


def test_receipt_ai_settings_keep_groq_config_when_groq_key_is_present():
    settings_obj = Settings(
        _env_file=None,
        GROQ_API_KEY="gsk_legacy_test",
        GROQ_BASE_URL="https://api.groq.com/openai/v1",
        GROQ_RECEIPT_VISION_MODEL="llama-vision",
        GROQ_RECEIPT_CLEANUP_MODEL="oss-cleanup",
    )

    assert settings_obj.receipt_ai_uses_openai is False
    assert settings_obj.receipt_ai_api_key == "gsk_legacy_test"
    assert settings_obj.receipt_ai_base_url == "https://api.groq.com/openai/v1"
    assert settings_obj.receipt_ai_vision_model == "llama-vision"
    assert settings_obj.receipt_ai_cleanup_model == "oss-cleanup"
