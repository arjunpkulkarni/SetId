import base64
import json
import mimetypes
import os
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from openai import OpenAI
from pydantic import BaseModel, Field, ValidationError, field_validator
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.receipt_pipeline import RECEIPT_PIPELINE_VERSION
from app.models.bill import Bill
from app.models.item_assignment import ItemAssignment
from app.models.receipt import ReceiptUpload
from app.models.receipt_item import ReceiptItem
from app.schemas.receipt import ParsedReceipt, ParsedReceiptItem
from app.services.receipt_feedback_service import record_item_edit_feedback
from app.services.receipt_item_normalizer import normalize_cleanup_payload
# Shared fuzzy regexes for summary labels (subtotal / total / tax / balance due).
# Keeping these in one module ensures the preparser and the defensive post-LLM
# filter agree on what counts as a label — otherwise misspellings can leak
# through one layer and show up as phantom line items.
from app.services.receipt_patterns import (
    BALANCE_DUE_RE,
    SUBTOTAL_FUZZY_RE,
    TAX_FUZZY_RE,
    TOTAL_FUZZY_RE,
)
from app.services.receipt_preparser import parse_structured_rows
from app.services.receipt_validator import validate_parsed_receipt

MONEY_QUANTIZE = Decimal("0.01")

# Defensive filter applied AFTER the LLM cleanup step. Anything the LLM
# returned whose name matches any of these patterns gets dropped before
# we persist line items.

NON_ITEM_PATTERNS = (
    re.compile(r"\bvisa\b", re.IGNORECASE),
    re.compile(r"\bmastercard\b", re.IGNORECASE),
    re.compile(r"\bamex\b", re.IGNORECASE),
    re.compile(r"\bdiscover\b", re.IGNORECASE),
    re.compile(r"\bbatch\b", re.IGNORECASE),
    re.compile(r"\btrace\b", re.IGNORECASE),
    re.compile(r"\bappr\b", re.IGNORECASE),
    re.compile(r"\bauth\b", re.IGNORECASE),
    re.compile(r"\btip\b", re.IGNORECASE),
    re.compile(r"\bgratuity\b", re.IGNORECASE),
    re.compile(r"\bservice\s+(?:charge|fee)\b", re.IGNORECASE),
    re.compile(r"\bchange(?:\s+due)?\b", re.IGNORECASE),
    re.compile(r"\bapproval\b", re.IGNORECASE),
    # Summary anchors (fuzzy, catches misspellings + compound labels).
    SUBTOTAL_FUZZY_RE,
    TOTAL_FUZZY_RE,
    TAX_FUZZY_RE,
    BALANCE_DUE_RE,
)
ADDRESS_PATTERN = re.compile(
    r"\b(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way)\b",
    re.IGNORECASE,
)
DATE_TIME_PATTERN = re.compile(
    r"^(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}:\d{2}(?:\s?[AP]M)?)$",
    re.IGNORECASE,
)

OCR_PROMPT = """
You are a layout-aware OCR engine for receipt images.
Return strict JSON only with this shape:
{
  "lines": [
    {
      "text": "BURGER",
      "bounding_box": { "x": 0.1, "y": 0.3, "w": 0.4, "h": 0.05 }
    }
  ]
}
Rules:
- Preserve reading order from top-to-bottom and left-to-right.
- Include every visible text line.
- bounding_box values must be normalized floats in [0, 1].
- Do not add markdown fences, prose, or extra keys.
""".strip()

OCR_RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "receipt_layout_ocr",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "lines": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "text": {"type": "string"},
                            "bounding_box": {
                                "type": "object",
                                "properties": {
                                    "x": {"type": "number"},
                                    "y": {"type": "number"},
                                    "w": {"type": "number"},
                                    "h": {"type": "number"},
                                },
                                "required": ["x", "y", "w", "h"],
                                "additionalProperties": False,
                            },
                        },
                        "required": ["text", "bounding_box"],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["lines"],
            "additionalProperties": False,
        },
    },
}

CLEANUP_SYSTEM_PROMPT = """
You are a receipt cleanup model. Return valid JSON only — no markdown, no prose, no
explanations.

An "item" is a purchased product or dish. The `items` array must contain ONLY
purchased items. If a line is any of the following, it is NOT an item — it either
maps to a dedicated top-level field (`subtotal` / `tax` / `total`) or is dropped
entirely:

  - subtotal, sub-total, sub total, subttl, subtoal, running subtotal, complete subtotal
  - total, grand total, net total, running total, total due
  - balance due, amount due, amount owed, amt due, pay this amount, to pay, please pay, charge
  - tax, sales tax, vat, gst, hst
  - tip, gratuity, service charge, service fee
  - change, change due, cash, credit, debit, card, visa, mastercard, amex, discover
  - approval, auth, batch, trace, merchant id, terminal id
  - addresses, phone numbers, dates, timestamps, "thank you" messages, loyalty codes

Critical rules:
  - If the same price appears on multiple lines and one line is a summary label
    (subtotal / total / balance / complete / running / grand / net), the price
    belongs in the corresponding top-level field, NOT duplicated into `items`.
  - Map `balance due` / `amount due` / `pay this amount` into the `total` field
    when no separate `total` line is present.
  - Never hallucinate items or prices. Use only evidence in the provided input.
  - For each item, `total_price` is the full line total. `unit_price` may be null
    when not explicitly derivable. `modifiers` is an array of strings (may be empty).
  - `confidence` is a number in [0, 1].
  - If a value cannot be determined confidently, return null for nullable fields.

Example input (tab-separated OCR rows):
  12 OZ STRIP\t26.99
  COMPLETE SUBTOTAL\t26.99
  SUBTOTAL\t26.99
  TAX\t3.17
  BALANCE DUE\t30.16

Correct output:
  {
    "merchant_name": null,
    "subtotal": 26.99,
    "tax": 3.17,
    "total": 30.16,
    "items": [
      {"name": "12 OZ STRIP", "quantity": 1, "unit_price": 26.99, "total_price": 26.99, "modifiers": []}
    ],
    "confidence": 0.9
  }

Notice: the COMPLETE SUBTOTAL and SUBTOTAL lines do NOT appear in `items` even
though they share a price with a real item. They are summary labels.
""".strip()

CLEANUP_RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "receipt_cleanup",
        # `strict: False` + loosened `required` so that smaller LLMs that
        # occasionally misplace fields (e.g. putting `confidence` on the
        # item instead of the top level) don't cause a hard 400 from the
        # Groq schema validator. The Python-side `CleanupReceiptPayload`
        # still normalizes and defaults missing values downstream.
        "strict": False,
        "schema": {
            "type": "object",
            "properties": {
                "merchant_name": {
                    "type": ["string", "null"],
                },
                "subtotal": {
                    "type": ["number", "null"],
                },
                "tax": {
                    "type": ["number", "null"],
                },
                "total": {
                    "type": ["number", "null"],
                },
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "quantity": {"type": "number"},
                            "unit_price": {"type": ["number", "null"]},
                            "total_price": {"type": "number"},
                            "modifiers": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                            # Tolerate the LLM putting confidence here even
                            # though we don't use it — prevents a 400 when
                            # the model accidentally emits it per-item.
                            "confidence": {"type": ["number", "null"]},
                        },
                        "required": ["name", "quantity", "unit_price", "total_price", "modifiers"],
                        "additionalProperties": True,
                    },
                },
                "confidence": {
                    "type": ["number", "null"],
                },
            },
            # `confidence` removed from required — smaller models sometimes
            # misplace it (e.g. onto items), which triggers a 400 from Groq's
            # schema validator. We default it to 0.5 in Python when missing.
            "required": ["merchant_name", "subtotal", "tax", "total", "items"],
            "additionalProperties": True,
        },
    },
}


def _coerce_decimal(value: object | None) -> Decimal | None:
    if value in (None, ""):
        return None
    if isinstance(value, Decimal):
        return value.quantize(MONEY_QUANTIZE)
    if isinstance(value, (int, float)):
        return Decimal(str(value)).quantize(MONEY_QUANTIZE)

    text = str(value).strip()
    text = re.sub(r"[^0-9.\-]", "", text)
    if not text:
        return None
    try:
        return Decimal(text).quantize(MONEY_QUANTIZE)
    except InvalidOperation as exc:
        raise ValueError(f"Invalid decimal value: {value}") from exc


def _coerce_quantity(value: object | None) -> int:
    if value in (None, ""):
        return 1
    try:
        quantity = int(str(value).strip())
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid quantity: {value}") from exc
    return max(quantity, 1)


class CleanupReceiptItem(BaseModel):
    name: str
    quantity: Decimal = Decimal("1")
    unit_price: Decimal | None = None
    total_price: Decimal
    modifiers: list[str] = Field(default_factory=list)

    @field_validator("name", mode="before")
    @classmethod
    def validate_name(cls, value: object) -> str:
        cleaned = " ".join(str(value or "").split()).strip(" -:")
        if not cleaned:
            raise ValueError("Item name cannot be blank")
        return cleaned

    @field_validator("quantity", mode="before")
    @classmethod
    def validate_quantity(cls, value: object) -> Decimal:
        quantity = _coerce_decimal(value)
        if quantity is None or quantity <= 0:
            raise ValueError("Item quantity must be greater than zero")
        return quantity

    @field_validator("unit_price", mode="before")
    @classmethod
    def validate_unit_price(cls, value: object) -> Decimal | None:
        price = _coerce_decimal(value)
        if price is not None and price <= 0:
            raise ValueError("Item unit price must be greater than zero")
        return price

    @field_validator("total_price", mode="before")
    @classmethod
    def validate_total_price(cls, value: object) -> Decimal:
        price = _coerce_decimal(value)
        if price is None or price <= 0:
            raise ValueError("Item total price must be greater than zero")
        return price

    @field_validator("modifiers", mode="before")
    @classmethod
    def validate_modifiers(cls, value: object) -> list[str]:
        if value in (None, ""):
            return []
        if not isinstance(value, list):
            raise ValueError("Item modifiers must be a list")
        return [" ".join(str(item or "").split()).strip() for item in value if str(item or "").strip()]


class CleanupReceiptPayload(BaseModel):
    merchant_name: str | None = None
    subtotal: Decimal | None = None
    tax: Decimal | None = None
    total: Decimal | None = None
    items: list[CleanupReceiptItem] = Field(default_factory=list)
    confidence: Decimal = Decimal("0.0")

    @field_validator("merchant_name", mode="before")
    @classmethod
    def validate_merchant_name(cls, value: object) -> str | None:
        cleaned = " ".join(str(value or "").split()).strip()
        return cleaned or None

    @field_validator("subtotal", "tax", "total", mode="before")
    @classmethod
    def validate_optional_money(cls, value: object) -> Decimal | None:
        return _coerce_decimal(value)

    @field_validator("confidence", mode="before")
    @classmethod
    def validate_confidence(cls, value: object) -> Decimal:
        # Default to 0.5 when the LLM omits confidence (some smaller
        # models put it in the wrong place or skip it entirely). The
        # validator downstream derives overall confidence from item
        # alignment + warnings too, so a neutral default here is fine.
        confidence = _coerce_decimal(value)
        if confidence is None:
            return Decimal("0.5")
        if confidence < 0:
            return Decimal("0.0")
        if confidence > 1:
            return Decimal("1.0")
        return confidence


class OCRBoundingBox(BaseModel):
    x: float
    y: float
    w: float
    h: float

    @field_validator("x", "y", "w", "h", mode="before")
    @classmethod
    def validate_normalized_coordinate(cls, value: object) -> float:
        try:
            numeric = float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError("OCR bounding box values must be numeric") from exc
        if numeric < 0 or numeric > 1:
            raise ValueError("OCR bounding box values must be normalized between 0 and 1")
        return numeric


class OCRLine(BaseModel):
    text: str
    bounding_box: OCRBoundingBox

    @field_validator("text", mode="before")
    @classmethod
    def validate_text(cls, value: object) -> str:
        cleaned = " ".join(str(value or "").split()).strip()
        if not cleaned:
            raise ValueError("OCR line text cannot be blank")
        return cleaned


class StructuredOCRPayload(BaseModel):
    lines: list[OCRLine] = Field(default_factory=list)


PREPARSER_CONFIDENCE_THRESHOLD = 0.85


class ReceiptParserService:
    def __init__(self, db: Session):
        self.db = db
        self._client = (
            OpenAI(
                api_key=settings.GROQ_API_KEY,
                base_url=settings.GROQ_BASE_URL,
            )
            if settings.GROQ_API_KEY
            else None
        )

    def save_upload(
        self,
        bill_id: str,
        file_content: bytes,
        filename: str,
        content_type: str,
        append: bool = False,
    ) -> ReceiptUpload:
        return self.save_upload_files(
            bill_id,
            [(file_content, filename, content_type)],
            append=append,
        )

    def _delete_receipt_files_on_disk(self, receipt: ReceiptUpload) -> None:
        paths: set[str] = set()
        if receipt.receipt_images:
            for img in receipt.receipt_images:
                p = img.get("file_path")
                if p:
                    paths.add(p)
        elif receipt.file_path:
            paths.add(receipt.file_path)
        for p in paths:
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                except OSError:
                    pass

    def save_upload_files(
        self,
        bill_id: str,
        files: list[tuple[bytes, str, str]],
        append: bool = False,
    ) -> ReceiptUpload:
        if not files:
            raise ValueError("At least one file is required")

        upload_dir = os.path.join(settings.UPLOAD_DIR, str(bill_id))
        os.makedirs(upload_dir, exist_ok=True)

        existing = self.get_receipt(bill_id)

        if append and existing:
            if not existing.receipt_images:
                existing.receipt_images = [
                    {
                        "file_path": existing.file_path,
                        "original_filename": existing.original_filename,
                        "content_type": existing.content_type,
                    }
                ]
            meta: list[dict] = list(existing.receipt_images)
            for file_content, filename, content_type in files:
                safe = os.path.basename(filename) or "receipt.jpg"
                unique_name = f"{uuid.uuid4().hex[:10]}_{safe}"
                file_path = os.path.join(upload_dir, unique_name)
                with open(file_path, "wb") as f:
                    f.write(file_content)
                meta.append(
                    {
                        "file_path": file_path,
                        "original_filename": filename or safe,
                        "content_type": content_type or "application/octet-stream",
                    }
                )
            existing.receipt_images = meta
            existing.file_path = meta[0]["file_path"]
            existing.original_filename = meta[0]["original_filename"]
            existing.content_type = meta[0]["content_type"]
            existing.is_multi_image = len(meta) > 1
            existing.ocr_structured_json = None
            existing.overall_confidence = None
            existing.validation_warnings = None
            existing.parsed_version = None
            existing.last_parsed_at = None
            existing.parsed = False
            existing.parsed_at = None
            self._reset_parsed_data(bill_id)
            self.db.commit()
            self.db.refresh(existing)
            return existing

        if existing:
            self._delete_receipt_files_on_disk(existing)

        meta = []
        for file_content, filename, content_type in files:
            safe = os.path.basename(filename) or "receipt.jpg"
            unique_name = f"{uuid.uuid4().hex[:10]}_{safe}"
            file_path = os.path.join(upload_dir, unique_name)
            with open(file_path, "wb") as f:
                f.write(file_content)
            meta.append(
                {
                    "file_path": file_path,
                    "original_filename": filename or safe,
                    "content_type": content_type or "application/octet-stream",
                }
            )

        if existing:
            receipt = existing
            receipt.receipt_images = meta
            receipt.file_path = meta[0]["file_path"]
            receipt.original_filename = meta[0]["original_filename"]
            receipt.content_type = meta[0]["content_type"]
            receipt.is_multi_image = len(meta) > 1
            receipt.ocr_structured_json = None
            receipt.overall_confidence = None
            receipt.validation_warnings = None
            receipt.parsed_version = None
            receipt.last_parsed_at = None
            receipt.parsed = False
            receipt.parsed_at = None
        else:
            receipt = ReceiptUpload(
                bill_id=bill_id,
                file_path=meta[0]["file_path"],
                original_filename=meta[0]["original_filename"],
                content_type=meta[0]["content_type"],
                receipt_images=meta,
                is_multi_image=len(meta) > 1,
                ocr_structured_json=None,
                overall_confidence=None,
                validation_warnings=None,
                parsed_version=None,
                last_parsed_at=None,
            )
            self.db.add(receipt)

        self._reset_parsed_data(bill_id)
        self.db.commit()
        self.db.refresh(receipt)
        return receipt

    def get_receipt(self, bill_id: str) -> ReceiptUpload | None:
        return (
            self.db.query(ReceiptUpload)
            .filter(ReceiptUpload.bill_id == bill_id)
            .first()
        )

    def _receipt_image_entries(self, receipt: ReceiptUpload) -> list[dict[str, str]]:
        # Backward-compatible bridge: legacy receipts still have a single file_path.
        if receipt.receipt_images:
            return list(receipt.receipt_images)
        return [
            {
                "file_path": receipt.file_path,
                "original_filename": receipt.original_filename,
                "content_type": receipt.content_type,
            }
        ]

    def _run_one_image_pipeline(
        self, file_path: str, content_type: str
    ) -> tuple[CleanupReceiptPayload, list[list[str]], dict | None]:
        structured_ocr, raw_text = self._extract_structured_ocr_from_path(file_path, content_type)
        rows = (
            structured_ocr.get("rows")
            if isinstance(structured_ocr, dict)
            else None
        )
        if not rows:
            rows = self._rows_from_raw_text(raw_text)

        pre = parse_structured_rows(rows)
        if rows:
            if float(pre.get("confidence", 0.0)) >= PREPARSER_CONFIDENCE_THRESHOLD:
                cleaned = self._cleanup_payload_from_preparser(pre)
            else:
                cleaned = self._cleanup_structured_data(rows=rows, preparsed=pre)
        else:
            cleaned = self._cleanup_payload_from_preparser(parse_structured_rows([]))

        cleaned = normalize_cleanup_payload(
            cleaned,
            llm_client=self._client if settings.RECEIPT_NORMALIZE_USE_LLM else None,
        )
        return cleaned, rows, structured_ocr if isinstance(structured_ocr, dict) else None

    def parse_receipt(self, bill_id: str) -> ParsedReceipt:
        receipt = self.get_receipt(bill_id)
        if not receipt:
            raise ValueError(f"No receipt found for bill {bill_id}")

        if receipt.parsed and receipt.parsed_version == RECEIPT_PIPELINE_VERSION:
            return self._build_parsed_receipt(bill_id)

        if receipt.parsed and receipt.parsed_version != RECEIPT_PIPELINE_VERSION:
            self._reset_parsed_data(bill_id)
            self.db.commit()
            receipt = self.get_receipt(bill_id)
            if not receipt:
                raise ValueError(f"No receipt found for bill {bill_id}")

        entries = self._receipt_image_entries(receipt)
        merge_notes: list[str] = []

        if len(entries) == 1:
            ent = entries[0]
            cleaned, rows, structured_ocr = self._run_one_image_pipeline(
                ent["file_path"], ent["content_type"]
            )
            receipt.ocr_structured_json = structured_ocr
            return self._persist_parsed_receipt(
                bill_id,
                receipt,
                cleaned,
                rows,
                extra_warnings=merge_notes or None,
                is_multi_image=None,
                num_images=None,
            )

        receipt.ocr_structured_json = None
        intermediates: list[dict] = []
        all_rows: list[list[str]] = []

        # Sequential by design: simpler error handling and deterministic merge order.
        for idx, ent in enumerate(entries):
            try:
                cleaned_i, rows_i, _ = self._run_one_image_pipeline(
                    ent["file_path"], ent["content_type"]
                )
                all_rows.extend(rows_i or [])
                intermediates.append(
                    {
                        "items": [
                            it.model_dump(mode="json") for it in cleaned_i.items
                        ],
                        "subtotal": float(cleaned_i.subtotal)
                        if cleaned_i.subtotal is not None
                        else None,
                        "tax": float(cleaned_i.tax) if cleaned_i.tax is not None else None,
                        "total": float(cleaned_i.total)
                        if cleaned_i.total is not None
                        else None,
                        "merchant_name": cleaned_i.merchant_name,
                        "confidence": float(cleaned_i.confidence),
                        "source_image_index": idx,
                    }
                )
            except Exception:
                merge_notes.append(f"Failed to parse image {idx + 1}")

        if not intermediates:
            raise ValueError(
                "All receipt images failed to parse"
                if merge_notes
                else "No receipt images available to parse"
            )

        from app.services.receipt_merge_service import merge_intermediate_parses

        merged_payload, merge_warnings_out = merge_intermediate_parses(
            intermediates,
            merge_warnings=list(merge_notes),
        )

        # Persist only the merged final output; per-image parses remain in-memory only.
        return self._persist_parsed_receipt(
            bill_id,
            receipt,
            merged_payload,
            all_rows,
            extra_warnings=merge_warnings_out,
            is_multi_image=True,
            num_images=len(entries),
        )

    def get_items(self, bill_id: str) -> list[ReceiptItem]:
        return (
            self.db.query(ReceiptItem)
            .filter(ReceiptItem.bill_id == bill_id)
            .order_by(ReceiptItem.sort_order)
            .all()
        )

    def sync_items(self, bill_id: str, data: dict, user_id: str | None = None) -> dict:
        bill = self.db.query(Bill).filter(Bill.id == bill_id).first()
        if not bill:
            raise ValueError(f"Bill {bill_id} not found")

        receipt = self.get_receipt(bill_id)
        if not receipt:
            raise ValueError(f"No receipt found for bill {bill_id}")

        existing_items = self.get_items(bill_id)
        item_map = {str(item.id): item for item in existing_items}
        delete_ids = {str(item_id) for item_id in data.get("deletes", [])}
        delete_item_uuids = [item.id for item in existing_items if str(item.id) in delete_ids]

        if delete_item_uuids:
            self.db.execute(
                delete(ItemAssignment).where(ItemAssignment.receipt_item_id.in_(delete_item_uuids))
            )
            self.db.execute(delete(ReceiptItem).where(ReceiptItem.id.in_(delete_item_uuids)))

        updated_items: list[ReceiptItem] = []
        for raw_update in data.get("updates", []):
            item_id = str(raw_update["id"])
            if item_id in delete_ids:
                continue

            item = item_map.get(item_id)
            if not item:
                raise ValueError(f"ReceiptItem {item_id} not found")

            before = self._item_snapshot(item)
            normalized = self._normalize_edit_item(
                name=raw_update["name"],
                quantity=raw_update["quantity"],
                total_price=raw_update["total_price"],
            )
            self._apply_item_values(item, normalized)
            after = self._item_snapshot(item)
            record_item_edit_feedback(
                self.db,
                receipt_item_id=item.id,
                bill_id=item.bill_id,
                user_id=uuid.UUID(user_id) if user_id else None,
                source="sync",
                before=before,
                after=after,
            )
            updated_items.append(item)

        created_items: list[ReceiptItem] = []
        for raw_create in data.get("creates", []):
            normalized = self._normalize_edit_item(
                name=raw_create["name"],
                quantity=raw_create["quantity"],
                total_price=raw_create["total_price"],
            )
            item = ReceiptItem(
                receipt_id=receipt.id,
                bill_id=bill_id,
                name=normalized["name"],
                quantity=normalized["quantity"],
                unit_price=normalized["unit_price"],
                total_price=normalized["total_price"],
                category=None,
                confidence=None,
                is_taxable=True,
                sort_order=0,
            )
            self.db.add(item)
            created_items.append(item)

        remaining_existing_items = [
            item for item in existing_items
            if str(item.id) not in delete_ids
        ]
        ordered_existing_items = sorted(remaining_existing_items, key=lambda item: item.sort_order)
        for index, item in enumerate([*created_items, *ordered_existing_items]):
            item.sort_order = index

        for item in updated_items:
            self._recalculate_assignments_for_item(item)

        self._recalculate_bill_totals(bill)
        self.db.commit()
        self.db.refresh(bill)

        return {
            "bill": bill,
            "items": self.get_items(bill_id),
        }

    def update_item(self, item_id: str, data: dict, user_id: str | None = None) -> ReceiptItem:
        item = self.db.query(ReceiptItem).filter(ReceiptItem.id == item_id).first()
        if not item:
            raise ValueError(f"ReceiptItem {item_id} not found")

        before = self._item_snapshot(item)

        total_price = data.get("total_price")
        if total_price is None and "unit_price" in data:
            unit_price = _coerce_decimal(data["unit_price"])
            quantity = data.get("quantity", item.quantity)
            if unit_price is None:
                raise ValueError("Receipt item unit price must be greater than zero")
            total_price = unit_price * Decimal(str(quantity))
        if total_price is None:
            total_price = item.total_price

        normalized = self._normalize_edit_item(
            name=data.get("name", item.name),
            quantity=data.get("quantity", item.quantity),
            total_price=total_price,
        )
        self._apply_item_values(item, normalized)

        for field in ("category", "is_taxable"):
            if field in data:
                setattr(item, field, data[field])

        after = self._item_snapshot(item)
        record_item_edit_feedback(
            self.db,
            receipt_item_id=item.id,
            bill_id=item.bill_id,
            user_id=uuid.UUID(user_id) if user_id else None,
            source="patch",
            before=before,
            after=after,
        )

        self._recalculate_assignments_for_item(item)
        bill = self.db.query(Bill).filter(Bill.id == item.bill_id).first()
        if bill:
            self._recalculate_bill_totals(bill)

        self.db.commit()
        self.db.refresh(item)
        return item

    def _reset_parsed_data(self, bill_id: str) -> None:
        items = self.get_items(bill_id)
        item_ids = [item.id for item in items]

        if item_ids:
            self.db.execute(
                delete(ItemAssignment).where(ItemAssignment.receipt_item_id.in_(item_ids))
            )
            self.db.execute(
                delete(ReceiptItem).where(ReceiptItem.bill_id == bill_id)
            )

        bill = self.db.query(Bill).filter(Bill.id == bill_id).first()
        if bill:
            bill.subtotal = Decimal("0.00")
            bill.tax = Decimal("0.00")
            bill.total = Decimal("0.00")
            bill.merchant_name = None

        receipt = self.get_receipt(bill_id)
        if receipt:
            receipt.overall_confidence = None
            receipt.validation_warnings = None
            receipt.parsed = False
            receipt.parsed_at = None
            receipt.last_parsed_at = None
            receipt.parsed_version = None

    def _extract_structured_ocr_from_path(
        self, file_path: str, content_type: str
    ) -> tuple[dict | None, str]:
        if not self._client:
            raise ValueError("GROQ_API_KEY is not configured")

        if not os.path.exists(file_path):
            raise ValueError("Uploaded receipt file is missing from storage")

        with open(file_path, "rb") as f:
            encoded = base64.b64encode(f.read()).decode("utf-8")

        ct = content_type
        if "/" not in ct:
            ct = mimetypes.guess_type(file_path)[0] or "image/jpeg"

        try:
            response = self._client.chat.completions.create(
                model=settings.GROQ_RECEIPT_VISION_MODEL,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": OCR_PROMPT},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:{ct};base64,{encoded}",
                                },
                            },
                        ],
                    }
                ],
                response_format=OCR_RESPONSE_FORMAT,
            )

            message = response.choices[0].message
            content = message.content or ""
            if not content:
                raise ValueError("Structured OCR returned no JSON")

            structured_payload = StructuredOCRPayload.model_validate(json.loads(content))
            rows = self._build_rows_from_structured_ocr(structured_payload.lines)
            raw_text = "\n".join(" ".join(row) for row in rows if row).strip()
            if not raw_text:
                raise ValueError("Structured OCR returned empty rows")
            return {"rows": rows}, raw_text
        except Exception:
            raw_text = self._extract_raw_text_fallback_from_path(file_path, encoded, ct)
            return None, raw_text

    def _extract_raw_text_fallback_from_path(
        self,
        file_path: str,
        encoded: str | None = None,
        content_type: str | None = None,
    ) -> str:
        if not self._client:
            raise ValueError("GROQ_API_KEY is not configured")

        if not os.path.exists(file_path):
            raise ValueError("Uploaded receipt file is missing from storage")

        if encoded is None:
            with open(file_path, "rb") as f:
                encoded = base64.b64encode(f.read()).decode("utf-8")

        ct = content_type or "image/jpeg"
        if "/" not in ct:
            ct = mimetypes.guess_type(file_path)[0] or "image/jpeg"

        response = self._client.chat.completions.create(
            model=settings.GROQ_RECEIPT_VISION_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "You are an OCR engine for receipt images.\n"
                                "Transcribe the visible text exactly as it appears, preserving line breaks and "
                                "approximate reading order.\n"
                                "Do not summarize, correct, interpret, or structure the text.\n"
                                "Return only the raw receipt text with no markdown fences or commentary."
                            ),
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{ct};base64,{encoded}",
                            },
                        },
                    ],
                }
            ],
        )
        raw_text = (response.choices[0].message.content or "").strip()
        if not raw_text:
            raise ValueError("OCR returned no text for this receipt")
        return raw_text

    def _build_rows_from_structured_ocr(self, lines: list[OCRLine]) -> list[list[str]]:
        if not lines:
            return []

        sorted_lines = sorted(lines, key=lambda line: (line.bounding_box.y, line.bounding_box.x))
        y_threshold = 0.02
        rows: list[dict[str, object]] = []

        for line in sorted_lines:
            y_center = line.bounding_box.y + (line.bounding_box.h / 2)
            placed = False
            for row in rows:
                row_y = float(row["y_center"])
                if abs(row_y - y_center) <= y_threshold:
                    row_lines = row["lines"]
                    assert isinstance(row_lines, list)
                    row_lines.append(line)
                    row["y_center"] = (row_y + y_center) / 2
                    placed = True
                    break

            if not placed:
                rows.append({"y_center": y_center, "lines": [line]})

        structured_rows: list[list[str]] = []
        rows.sort(key=lambda row: float(row["y_center"]))
        for row in rows:
            row_lines = row["lines"]
            assert isinstance(row_lines, list)
            ordered = sorted(row_lines, key=lambda entry: entry.bounding_box.x)
            row_tokens = [entry.text for entry in ordered if entry.text]
            if row_tokens:
                structured_rows.append(row_tokens)

        return structured_rows

    def _rows_from_raw_text(self, raw_text: str) -> list[list[str]]:
        return [[line.strip()] for line in raw_text.splitlines() if line.strip()]

    def _cleanup_payload_from_preparser(self, preparsed: dict) -> CleanupReceiptPayload:
        return CleanupReceiptPayload.model_validate(
            {
                "merchant_name": None,
                "subtotal": preparsed.get("totals", {}).get("subtotal"),
                "tax": preparsed.get("totals", {}).get("tax"),
                "total": preparsed.get("totals", {}).get("total"),
                "items": [
                    {
                        "name": item["name"],
                        "quantity": item.get("quantity", 1),
                        "unit_price": item.get("unit_price"),
                        "total_price": item.get("total_price", item.get("price")),
                        "modifiers": item.get("modifiers", []),
                    }
                    for item in preparsed.get("items", [])
                ],
                "confidence": preparsed.get("confidence", 0.0),
            }
        )

    def _cleanup_structured_data(
        self,
        *,
        rows: list[list[str]] | None,
        preparsed: dict | None,
    ) -> CleanupReceiptPayload:
        if not self._client:
            raise ValueError("GROQ_API_KEY is not configured")

        fallback = self._cleanup_payload_from_preparser(preparsed or {})
        user_payload = {
            "rows": rows or [],
            "preparsed": preparsed or {},
        }

        for _ in range(2):
            response = self._client.chat.completions.create(
                model=settings.GROQ_RECEIPT_CLEANUP_MODEL,
                messages=[
                    {"role": "system", "content": CLEANUP_SYSTEM_PROMPT},
                    {"role": "user", "content": json.dumps(user_payload)},
                ],
                response_format=CLEANUP_RESPONSE_FORMAT,
            )

            message = response.choices[0].message
            if getattr(message, "refusal", None):
                continue

            content = message.content or ""
            if not content:
                continue

            try:
                payload = json.loads(content)
                return CleanupReceiptPayload.model_validate(payload)
            except (json.JSONDecodeError, ValidationError, ValueError):
                continue

        return fallback

    def _persist_parsed_receipt(
        self,
        bill_id: str,
        receipt: ReceiptUpload,
        cleaned: CleanupReceiptPayload,
        rows: list[list[str]] | None = None,
        *,
        extra_warnings: list[str] | None = None,
        is_multi_image: bool | None = None,
        num_images: int | None = None,
    ) -> ParsedReceipt:
        self._reset_parsed_data(bill_id)

        validated = validate_parsed_receipt(
            items=[
                {
                    "name": item.name,
                    "quantity": item.quantity,
                    "unit_price": item.unit_price,
                    "total_price": item.total_price,
                    "modifiers": item.modifiers,
                }
                for item in cleaned.items
            ],
            subtotal=cleaned.subtotal,
            tax=cleaned.tax,
            total=cleaned.total,
            llm_confidence=cleaned.confidence,
            rows=rows,
        )

        warnings: list[str] = []
        if extra_warnings:
            warnings.extend(extra_warnings)
        warnings.extend(validated["warnings"])
        parsed_items: list[ParsedReceiptItem] = []
        db_items: list[ReceiptItem] = []

        for item in validated["items"]:
            normalized = self._normalize_validated_item(item)
            if not normalized:
                continue

            name = normalized["name"]
            # `_normalize_validated_item` returns `total_price` (the line's full
            # cost across all units) and `unit_price` separately. We want the
            # line total here because the loop below re-distributes cents
            # across `quantity` individual rows.
            price = normalized["total_price"]
            quantity = normalized["quantity"]

            # Expand multi-unit lines into one quantity=1 row per unit so each unit
            # can be assigned to a different member. Cents are distributed so the
            # per-line sum matches the parsed total exactly (e.g. $10.00 / 3 ->
            # $3.34 + $3.33 + $3.33).
            total_cents = int((price * 100).to_integral_value(rounding=ROUND_HALF_UP))
            base_cents, remainder = divmod(total_cents, quantity)

            for unit_index in range(quantity):
                unit_cents = base_cents + (1 if unit_index < remainder else 0)
                unit_total = (Decimal(unit_cents) / Decimal(100)).quantize(MONEY_QUANTIZE)

                db_item = ReceiptItem(
                    receipt_id=receipt.id,
                    bill_id=bill_id,
                    name=name,
                    quantity=1,
                    unit_price=unit_total,
                    total_price=unit_total,
                    category=None,
                    confidence=None,
                    is_taxable=True,
                    sort_order=len(db_items),
                )
                self.db.add(db_item)
                db_items.append(db_item)
                parsed_items.append(
                    ParsedReceiptItem(
                        name=name,
                        price=unit_total,
                        quantity=1,
                    )
                )

        if not parsed_items:
            raise ValueError("No purchasable items could be parsed from this receipt")

        subtotal = validated["subtotal"]
        tax = validated["tax"]
        if cleaned.tax is None:
            warnings.append("Tax was not detected; defaulted to 0.")

        total = validated["total"]

        bill = self.db.query(Bill).filter(Bill.id == bill_id).first()
        if bill:
            bill.subtotal = subtotal
            bill.tax = tax
            bill.total = total
            if cleaned.merchant_name:
                bill.merchant_name = cleaned.merchant_name

        now = datetime.now(timezone.utc)
        receipt.parsed = True
        receipt.parsed_at = now
        receipt.last_parsed_at = now
        receipt.parsed_version = RECEIPT_PIPELINE_VERSION
        receipt.overall_confidence = validated["overall_confidence"]
        receipt.validation_warnings = warnings

        self.db.commit()
        return ParsedReceipt(
            merchant_name=cleaned.merchant_name,
            subtotal=subtotal,
            items=parsed_items,
            tax=tax,
            total=total,
            pipeline_version=RECEIPT_PIPELINE_VERSION,
            overall_confidence=validated["overall_confidence"],
            warnings=warnings,
            is_multi_image=is_multi_image,
            num_images=num_images,
        )

    def _build_parsed_receipt(self, bill_id: str) -> ParsedReceipt:
        bill = self.db.query(Bill).filter(Bill.id == bill_id).first()
        if not bill:
            raise ValueError(f"Bill {bill_id} not found")

        receipt = self.get_receipt(bill_id)
        items = self.get_items(bill_id)
        num_imgs = (
            len(receipt.receipt_images)
            if receipt and receipt.receipt_images
            else (1 if receipt else None)
        )
        return ParsedReceipt(
            merchant_name=bill.merchant_name,
            subtotal=bill.subtotal,
            items=[
                ParsedReceiptItem(
                    name=item.name,
                    price=item.total_price,
                    quantity=item.quantity,
                )
                for item in items
            ],
            tax=bill.tax,
            total=bill.total,
            pipeline_version=receipt.parsed_version if receipt else None,
            overall_confidence=receipt.overall_confidence if receipt else None,
            warnings=list(receipt.validation_warnings or []) if receipt else [],
            is_multi_image=receipt.is_multi_image if receipt else None,
            num_images=num_imgs,
        )

    def _normalize_item(self, item: CleanupReceiptItem) -> dict | None:
        name = " ".join(item.name.split()).strip(" -:")
        if not name or self._looks_like_non_item(name):
            return None

        quantity_decimal = item.quantity.quantize(MONEY_QUANTIZE)
        quantity = int(quantity_decimal) if quantity_decimal == quantity_decimal.to_integral_value() else 1
        total_price = item.total_price.quantize(MONEY_QUANTIZE)
        unit_price = (
            item.unit_price.quantize(MONEY_QUANTIZE)
            if item.unit_price is not None
            else (
                (total_price / quantity).quantize(MONEY_QUANTIZE, rounding=ROUND_HALF_UP)
                if quantity > 0
                else total_price
            )
        )

        return {
            "name": name,
            "quantity": quantity,
            "unit_price": unit_price,
            "total_price": total_price,
        }

    def _normalize_validated_item(self, item: dict) -> dict | None:
        name = " ".join(str(item.get("name", "")).split()).strip(" -:")
        if not name or self._looks_like_non_item(name):
            return None

        quantity_decimal = _coerce_decimal(item.get("quantity")) or Decimal("1.00")
        quantity = (
            int(quantity_decimal)
            if quantity_decimal == quantity_decimal.to_integral_value()
            else 1
        )
        total_price = (_coerce_decimal(item.get("total_price")) or Decimal("0.00")).quantize(MONEY_QUANTIZE)
        unit_price = _coerce_decimal(item.get("unit_price"))
        if unit_price is None:
            unit_price = (
                (total_price / quantity).quantize(MONEY_QUANTIZE, rounding=ROUND_HALF_UP)
                if quantity > 0
                else total_price
            )
        else:
            unit_price = unit_price.quantize(MONEY_QUANTIZE)

        return {
            "name": name,
            "quantity": quantity,
            "unit_price": unit_price,
            "total_price": total_price,
            "confidence": float(item.get("confidence", 0.0)),
        }

    def _looks_like_non_item(self, text: str) -> bool:
        lowered = text.strip().lower()
        if not lowered:
            return True
        if DATE_TIME_PATTERN.match(lowered):
            return True
        if ADDRESS_PATTERN.search(lowered) and any(char.isdigit() for char in lowered):
            return True
        return any(pattern.search(lowered) for pattern in NON_ITEM_PATTERNS)

    def _normalize_edit_item(
        self,
        *,
        name: object,
        quantity: object,
        total_price: object,
    ) -> dict:
        cleaned_name = " ".join(str(name or "").split()).strip()
        if not cleaned_name:
            raise ValueError("Receipt items must have a name")

        try:
            normalized_quantity = int(str(quantity).strip())
        except (TypeError, ValueError) as exc:
            raise ValueError("Receipt items must have a valid quantity") from exc
        if normalized_quantity <= 0:
            raise ValueError("Receipt items must have quantity greater than zero")

        normalized_total = _coerce_decimal(total_price)
        if normalized_total is None or normalized_total <= 0:
            raise ValueError("Receipt items must have price greater than zero")

        unit_price = (
            (normalized_total / normalized_quantity).quantize(MONEY_QUANTIZE, rounding=ROUND_HALF_UP)
            if normalized_quantity > 1
            else normalized_total
        )

        return {
            "name": cleaned_name,
            "quantity": normalized_quantity,
            "total_price": normalized_total,
            "unit_price": unit_price,
        }

    def _apply_item_values(self, item: ReceiptItem, data: dict) -> None:
        item.name = data["name"]
        item.quantity = data["quantity"]
        item.total_price = data["total_price"]
        item.unit_price = data["unit_price"]

    @staticmethod
    def _item_snapshot(item: ReceiptItem) -> dict:
        return {
            "name": item.name,
            "quantity": item.quantity,
            "unit_price": item.unit_price,
            "total_price": item.total_price,
        }

    def _recalculate_bill_totals(self, bill: Bill) -> None:
        subtotal = sum(
            (
                item.total_price
                for item in self.db.query(ReceiptItem).filter(ReceiptItem.bill_id == bill.id).all()
            ),
            Decimal("0.00"),
        ).quantize(MONEY_QUANTIZE)
        bill.subtotal = subtotal
        # Tip is already on the receipt, don't add it again
        bill.total = (
            subtotal
            + (bill.tax or Decimal("0.00"))
            + (bill.service_fee or Decimal("0.00"))
        ).quantize(MONEY_QUANTIZE)

    def _recalculate_assignments_for_item(self, item: ReceiptItem) -> None:
        assignments = (
            self.db.query(ItemAssignment)
            .filter(ItemAssignment.receipt_item_id == item.id)
            .all()
        )
        if not assignments:
            return

        equal_count = len(assignments)
        for assignment in assignments:
            if assignment.share_type == "equal":
                if equal_count <= 0:
                    assignment.amount_owed = Decimal("0.00")
                else:
                    assignment.amount_owed = (
                        item.total_price / equal_count
                    ).quantize(MONEY_QUANTIZE, rounding=ROUND_HALF_UP)
            elif assignment.share_type == "percentage":
                assignment.amount_owed = (
                    item.total_price * assignment.share_value / Decimal("100")
                ).quantize(MONEY_QUANTIZE, rounding=ROUND_HALF_UP)
            elif assignment.share_type == "fixed":
                assignment.amount_owed = assignment.share_value.quantize(
                    MONEY_QUANTIZE,
                    rounding=ROUND_HALF_UP,
                )
