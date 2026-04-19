import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ReceiptItemFeedback(Base):
    """User corrections vs parsed values (learning signal)."""

    __tablename__ = "receipt_item_feedback"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    receipt_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("receipt_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    bill_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("bills.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="edit")

    original_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    corrected_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    original_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    corrected_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    original_unit_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    corrected_unit_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    original_total_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    corrected_total_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    receipt_item = relationship("ReceiptItem", back_populates="feedback_rows")
    bill = relationship("Bill", back_populates="receipt_item_feedback")
