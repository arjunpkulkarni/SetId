import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, UploadFile, File
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.core.response import success_response, error_response
from app.schemas.receipt import ReceiptUploadOut, ReceiptItemOut, ReceiptItemUpdate, ParsedReceipt
from app.services.receipt_parser_service import ReceiptParserService

router = APIRouter(prefix="/bills/{bill_id}/receipt", tags=["Receipts"])


@router.post("/upload", status_code=201)
async def upload_receipt(
    bill_id: uuid.UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = ReceiptParserService(db)
    file_content = await file.read()
    try:
        receipt = svc.save_upload(
            bill_id=str(bill_id),
            file_content=file_content,
            filename=file.filename or "receipt",
            content_type=file.content_type or "application/octet-stream",
        )
    except ValueError as e:
        return error_response("UPLOAD_ERROR", str(e), 400)

    return success_response(
        data=ReceiptUploadOut.model_validate(receipt).model_dump(),
        message="Receipt uploaded",
    )


@router.get("")
def get_receipt(
    bill_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = ReceiptParserService(db)
    receipt = svc.get_receipt(str(bill_id))
    if not receipt:
        return error_response("NOT_FOUND", "No receipt found for this bill", 404)

    return success_response(data=ReceiptUploadOut.model_validate(receipt).model_dump())


@router.post("/parse")
def parse_receipt(
    bill_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = ReceiptParserService(db)
    try:
        items = svc.parse_receipt(str(bill_id))
    except ValueError as e:
        return error_response("PARSE_ERROR", str(e), 400)

    items_out = [ReceiptItemOut.model_validate(item) for item in items]

    subtotal = sum((i.total_price for i in items_out), Decimal("0"))
    taxable = sum((i.total_price for i in items_out if i.is_taxable), Decimal("0"))
    tax = (taxable * Decimal("0.09")).quantize(Decimal("0.01"))
    total = subtotal + tax

    parsed = ParsedReceipt(
        merchant_name=None,
        items=[i.model_dump() for i in items_out],
        subtotal=subtotal,
        tax=tax,
        total=total,
    )
    return success_response(data=parsed.model_dump(), message="Receipt parsed successfully")


@router.patch("/items/{item_id}")
def update_receipt_item(
    bill_id: uuid.UUID,
    item_id: uuid.UUID,
    body: ReceiptItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = ReceiptParserService(db)
    try:
        item = svc.update_item(str(item_id), body.model_dump(exclude_unset=True))
    except ValueError:
        return error_response("NOT_FOUND", "Receipt item not found", 404)

    return success_response(
        data=ReceiptItemOut.model_validate(item).model_dump(),
        message="Item updated",
    )


@router.get("/items")
def list_receipt_items(
    bill_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = ReceiptParserService(db)
    items = svc.get_items(str(bill_id))
    items_data = [ReceiptItemOut.model_validate(i).model_dump() for i in items]
    return success_response(data=items_data)
