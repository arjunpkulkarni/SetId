import uuid
from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ItemAssignment(Base):
    __tablename__ = "item_assignments"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    receipt_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("receipt_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    bill_member_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("bill_members.id", ondelete="CASCADE"),
        nullable=False,
    )
    share_type: Mapped[str] = mapped_column(String(20), default="equal")
    share_value: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=0)
    amount_owed: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)

    item = relationship("ReceiptItem", back_populates="assignments")
    member = relationship("BillMember", back_populates="assignments")
