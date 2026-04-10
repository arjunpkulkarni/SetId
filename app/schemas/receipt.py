import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class ReceiptUploadOut(BaseModel):
    id: uuid.UUID
    bill_id: uuid.UUID
    file_path: str
    original_filename: str
    content_type: str
    parsed: bool
    parsed_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ReceiptItemOut(BaseModel):
    id: uuid.UUID
    receipt_id: uuid.UUID
    bill_id: uuid.UUID
    name: str
    quantity: int
    unit_price: Decimal
    total_price: Decimal
    category: str | None = None
    confidence: float | None = None
    is_taxable: bool
    sort_order: int

    model_config = {"from_attributes": True}


class ReceiptItemUpdate(BaseModel):
    name: str | None = None
    quantity: int | None = None
    unit_price: Decimal | None = None
    total_price: Decimal | None = None
    category: str | None = None
    is_taxable: bool | None = None


class ParsedReceipt(BaseModel):
    merchant_name: str | None = None
    items: list[ReceiptItemOut]
    subtotal: Decimal
    tax: Decimal
    total: Decimal
