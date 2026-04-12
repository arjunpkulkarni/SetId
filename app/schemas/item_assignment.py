import uuid
from decimal import Decimal

from pydantic import BaseModel


class AssignmentCreate(BaseModel):
    receipt_item_id: uuid.UUID
    bill_member_id: uuid.UUID
    share_type: str = "equal"
    share_value: Decimal = Decimal("0")


class AssignmentBulkCreate(BaseModel):
    assignments: list[AssignmentCreate]
    send_payment_notifications: bool = True


class AssignmentUpdate(BaseModel):
    share_type: str | None = None
    share_value: Decimal | None = None


class AssignmentOut(BaseModel):
    id: uuid.UUID
    receipt_item_id: uuid.UUID
    bill_member_id: uuid.UUID
    share_type: str
    share_value: Decimal
    amount_owed: Decimal
    item_name: str | None = None
    member_nickname: str | None = None

    model_config = {"from_attributes": True}


class AutoSplitRequest(BaseModel):
    member_ids: list[uuid.UUID] | None = None
    send_payment_notifications: bool = True
