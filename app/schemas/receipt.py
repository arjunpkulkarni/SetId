import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


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


class ReceiptItemSyncUpdate(BaseModel):
    id: uuid.UUID
    name: str
    quantity: int
    total_price: Decimal


class ReceiptItemCreate(BaseModel):
    name: str
    quantity: int
    total_price: Decimal


class ReceiptItemSyncRequest(BaseModel):
    updates: list[ReceiptItemSyncUpdate] = Field(default_factory=list)
    creates: list[ReceiptItemCreate] = Field(default_factory=list)
    deletes: list[uuid.UUID] = Field(default_factory=list)


class ParsedReceiptItem(BaseModel):
    name: str
    price: Decimal
    quantity: int


class ParsedReceipt(BaseModel):
    items: list[ParsedReceiptItem]
    tax: Decimal
    total: Decimal
    merchant_name: str | None = None
    subtotal: Decimal | None = None
    warnings: list[str] = Field(default_factory=list)
