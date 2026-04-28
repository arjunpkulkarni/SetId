import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Bill(Base):
    __tablename__ = "bills"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    merchant_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    status: Mapped[str] = mapped_column(String(50), default="draft")
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    tax: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    tip: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    tip_split_mode: Mapped[str] = mapped_column(String(20), default="proportional")
    service_fee: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    service_fee_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    service_fee_percentage: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # --- Readiness / payout gate ---
    ready_to_pay: Mapped[bool] = mapped_column(Boolean, default=False)
    ready_marked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    ready_marked_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    ready_reason: Mapped[str | None] = mapped_column(String(50), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    owner = relationship("User", back_populates="bills_owned", foreign_keys=[owner_id])
    members = relationship(
        "BillMember", back_populates="bill", cascade="all, delete-orphan"
    )
    receipt = relationship(
        "ReceiptUpload", back_populates="bill", uselist=False, cascade="all, delete-orphan"
    )
    receipt_items = relationship(
        "ReceiptItem", back_populates="bill", cascade="all, delete-orphan"
    )
    payments = relationship(
        "Payment", back_populates="bill", cascade="all, delete-orphan"
    )
    settlements = relationship(
        "Settlement", back_populates="bill", cascade="all, delete-orphan"
    )
    virtual_cards = relationship(
        "VirtualCard", back_populates="bill", cascade="all, delete-orphan"
    )
    receipt_parse_jobs = relationship(
        "ReceiptParseJob", back_populates="bill", cascade="all, delete-orphan"
    )
    receipt_item_feedback = relationship(
        "ReceiptItemFeedback", back_populates="bill", cascade="all, delete-orphan"
    )
