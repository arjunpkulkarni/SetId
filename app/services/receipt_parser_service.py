import base64
import json
import mimetypes
import os
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from openai import OpenAI
from pydantic import BaseModel, Field, ValidationError, field_validator
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.bill import Bill
from app.models.item_assignment import ItemAssignment
from app.models.receipt import ReceiptUpload
from app.models.receipt_item import ReceiptItem
from app.schemas.receipt import ParsedReceipt, ParsedReceiptItem

MONEY_QUANTIZE = Decimal("0.01")
NON_ITEM_PATTERNS = (
    re.compile(r"\bvisa\b", re.IGNORECASE),
    re.compile(r"\bmastercard\b", re.IGNORECASE),
    re.compile(r"\bamex\b", re.IGNORECASE),
    re.compile(r"\bdiscover\b", re.IGNORECASE),
    re.compile(r"\bbatch\b", re.IGNORECASE),
    re.compile(r"\btrace\b", re.IGNORECASE),
    re.compile(r"\bappr\b", re.IGNORECASE),
    re.compile(r"\bauth\b", re.IGNORECASE),
    re.compile(r"\bsubtotal\b", re.IGNORECASE),
    re.compile(r"\btotal\b", re.IGNORECASE),
    re.compile(r"\btax\b", re.IGNORECASE),
    re.compile(r"\btip\b", re.IGNORECASE),
    re.compile(r"\bchange\b", re.IGNORECASE),
    re.compile(r"\bapproval\b", re.IGNORECASE),
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
You are an OCR engine for receipt images.
Transcribe the visible text exactly as it appears, preserving line breaks and approximate reading order.
Do not summarize, correct, interpret, or structure the text.
Return only the raw receipt text with no markdown fences or commentary.
""".strip()

CLEANUP_SYSTEM_PROMPT = """
You clean noisy OCR text from retail and restaurant receipts.
Return strict JSON only.
Extract purchased line items only and ignore addresses, dates, timestamps, payment method lines,
card digits, approval codes, batch numbers, trace numbers, and other transaction metadata.
For each item, output:
- name
- quantity
- price (the full line-item amount to split, not the unit price)
Also extract tax and total when present. Merchant name and subtotal are optional enrichments.
Do not invent items. If a field is missing, return null for optional totals and default quantity to 1.
""".strip()

CLEANUP_RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "receipt_cleanup",
        "strict": True,
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
                            "price": {"type": "number"},
                            "quantity": {"type": "integer"},
                        },
                        "required": ["name", "price", "quantity"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["merchant_name", "subtotal", "tax", "total", "items"],
            "additionalProperties": False,
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
    price: Decimal
    quantity: int = 1

    @field_validator("name", mode="before")
    @classmethod
    def validate_name(cls, value: object) -> str:
        cleaned = " ".join(str(value or "").split()).strip(" -:")
        if not cleaned:
            raise ValueError("Item name cannot be blank")
        return cleaned

    @field_validator("price", mode="before")
    @classmethod
    def validate_price(cls, value: object) -> Decimal:
        price = _coerce_decimal(value)
        if price is None or price <= 0:
            raise ValueError("Item price must be greater than zero")
        return price

    @field_validator("quantity", mode="before")
    @classmethod
    def validate_quantity(cls, value: object) -> int:
        return _coerce_quantity(value)


class CleanupReceiptPayload(BaseModel):
    merchant_name: str | None = None
    subtotal: Decimal | None = None
    tax: Decimal | None = None
    total: Decimal | None = None
    items: list[CleanupReceiptItem] = Field(default_factory=list)

    @field_validator("merchant_name", mode="before")
    @classmethod
    def validate_merchant_name(cls, value: object) -> str | None:
        cleaned = " ".join(str(value or "").split()).strip()
        return cleaned or None

    @field_validator("subtotal", "tax", "total", mode="before")
    @classmethod
    def validate_optional_money(cls, value: object) -> Decimal | None:
        return _coerce_decimal(value)


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
    ) -> ReceiptUpload:
        upload_dir = os.path.join(settings.UPLOAD_DIR, str(bill_id))
        os.makedirs(upload_dir, exist_ok=True)

        existing = self.get_receipt(bill_id)
        file_path = os.path.join(upload_dir, filename)

        if existing and existing.file_path != file_path and os.path.exists(existing.file_path):
            os.remove(existing.file_path)

        with open(file_path, "wb") as f:
            f.write(file_content)

        if existing:
            receipt = existing
            receipt.file_path = file_path
            receipt.original_filename = filename
            receipt.content_type = content_type
            receipt.parsed = False
            receipt.parsed_at = None
        else:
            receipt = ReceiptUpload(
                bill_id=bill_id,
                file_path=file_path,
                original_filename=filename,
                content_type=content_type,
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

    def parse_receipt(self, bill_id: str) -> ParsedReceipt:
        receipt = self.get_receipt(bill_id)
        if not receipt:
            raise ValueError(f"No receipt found for bill {bill_id}")

        if receipt.parsed:
            return self._build_parsed_receipt(bill_id)

        raw_text = self._extract_raw_text(receipt)
        cleaned = self._cleanup_ocr_text(raw_text)
        return self._persist_parsed_receipt(bill_id, receipt, cleaned)

    def get_items(self, bill_id: str) -> list[ReceiptItem]:
        return (
            self.db.query(ReceiptItem)
            .filter(ReceiptItem.bill_id == bill_id)
            .order_by(ReceiptItem.sort_order)
            .all()
        )

    def sync_items(self, bill_id: str, data: dict) -> dict:
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

            normalized = self._normalize_edit_item(
                name=raw_update["name"],
                quantity=raw_update["quantity"],
                total_price=raw_update["total_price"],
            )
            self._apply_item_values(item, normalized)
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

    def update_item(self, item_id: str, data: dict) -> ReceiptItem:
        item = self.db.query(ReceiptItem).filter(ReceiptItem.id == item_id).first()
        if not item:
            raise ValueError(f"ReceiptItem {item_id} not found")

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

    def _extract_raw_text(self, receipt: ReceiptUpload) -> str:
        if not self._client:
            raise ValueError("GROQ_API_KEY is not configured")

        if not os.path.exists(receipt.file_path):
            raise ValueError("Uploaded receipt file is missing from storage")

        with open(receipt.file_path, "rb") as f:
            encoded = base64.b64encode(f.read()).decode("utf-8")

        content_type = receipt.content_type
        if "/" not in content_type:
            content_type = mimetypes.guess_type(receipt.file_path)[0] or "image/jpeg"

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
                                "url": f"data:{content_type};base64,{encoded}",
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

    def _cleanup_ocr_text(self, raw_text: str) -> CleanupReceiptPayload:
        if not self._client:
            raise ValueError("GROQ_API_KEY is not configured")

        response = self._client.chat.completions.create(
            model=settings.GROQ_RECEIPT_CLEANUP_MODEL,
            messages=[
                {"role": "system", "content": CLEANUP_SYSTEM_PROMPT},
                {"role": "user", "content": raw_text},
            ],
            response_format=CLEANUP_RESPONSE_FORMAT,
        )

        message = response.choices[0].message
        if getattr(message, "refusal", None):
            raise ValueError(f"Receipt cleanup refused: {message.refusal}")

        content = message.content or ""
        if not content:
            raise ValueError("Receipt cleanup returned no structured JSON")

        try:
            payload = json.loads(content)
            return CleanupReceiptPayload.model_validate(payload)
        except (json.JSONDecodeError, ValidationError, ValueError) as exc:
            raise ValueError("Receipt cleanup returned invalid structured data") from exc

    def _persist_parsed_receipt(
        self,
        bill_id: str,
        receipt: ReceiptUpload,
        cleaned: CleanupReceiptPayload,
    ) -> ParsedReceipt:
        self._reset_parsed_data(bill_id)

        warnings: list[str] = []
        parsed_items: list[ParsedReceiptItem] = []
        db_items: list[ReceiptItem] = []

        for item in cleaned.items:
            normalized = self._normalize_item(item)
            if not normalized:
                continue

            price = normalized["price"]
            quantity = normalized["quantity"]
            total_price = price
            unit_price = (
                (price / quantity).quantize(MONEY_QUANTIZE, rounding=ROUND_HALF_UP)
                if quantity > 1
                else price
            )

            db_item = ReceiptItem(
                receipt_id=receipt.id,
                bill_id=bill_id,
                name=normalized["name"],
                quantity=quantity,
                unit_price=unit_price,
                total_price=total_price,
                category=None,
                confidence=None,
                is_taxable=True,
                sort_order=len(db_items),
            )
            self.db.add(db_item)
            db_items.append(db_item)
            parsed_items.append(
                ParsedReceiptItem(
                    name=normalized["name"],
                    price=total_price,
                    quantity=quantity,
                )
            )

        if not parsed_items:
            raise ValueError("No purchasable items could be parsed from this receipt")

        subtotal = sum((item.price for item in parsed_items), Decimal("0.00")).quantize(MONEY_QUANTIZE)
        tax = cleaned.tax if cleaned.tax is not None else Decimal("0.00")
        if cleaned.tax is None:
            warnings.append("Tax was not detected; defaulted to 0.")

        total = cleaned.total if cleaned.total is not None else (subtotal + tax).quantize(MONEY_QUANTIZE)
        if cleaned.total is None:
            warnings.append("Total was not detected; computed from items and tax.")

        bill = self.db.query(Bill).filter(Bill.id == bill_id).first()
        if bill:
            bill.subtotal = subtotal
            bill.tax = tax
            bill.total = total
            if cleaned.merchant_name:
                bill.merchant_name = cleaned.merchant_name

        receipt.parsed = True
        receipt.parsed_at = datetime.now(timezone.utc)

        self.db.commit()
        return ParsedReceipt(
            merchant_name=cleaned.merchant_name,
            subtotal=cleaned.subtotal if cleaned.subtotal is not None else subtotal,
            items=parsed_items,
            tax=tax,
            total=total,
            warnings=warnings,
        )

    def _build_parsed_receipt(self, bill_id: str) -> ParsedReceipt:
        bill = self.db.query(Bill).filter(Bill.id == bill_id).first()
        if not bill:
            raise ValueError(f"Bill {bill_id} not found")

        items = self.get_items(bill_id)
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
            warnings=[],
        )

    def _normalize_item(self, item: CleanupReceiptItem) -> dict | None:
        name = " ".join(item.name.split()).strip(" -:")
        if not name or self._looks_like_non_item(name):
            return None

        return {
            "name": name,
            "quantity": _coerce_quantity(item.quantity),
            "price": item.price.quantize(MONEY_QUANTIZE),
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

    def _recalculate_bill_totals(self, bill: Bill) -> None:
        subtotal = sum(
            (
                item.total_price
                for item in self.db.query(ReceiptItem).filter(ReceiptItem.bill_id == bill.id).all()
            ),
            Decimal("0.00"),
        ).quantize(MONEY_QUANTIZE)
        bill.subtotal = subtotal
        bill.total = (
            subtotal
            + (bill.tax or Decimal("0.00"))
            + (bill.tip or Decimal("0.00"))
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
