import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, File, Header, Query, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models.user import User
from app.core.response import success_response, error_response
from app.schemas.bill import BillOut
from app.schemas.receipt import (
    ReceiptItemOut,
    ReceiptItemUpdate,
    ReceiptItemSyncRequest,
    receipt_upload_to_out,
)
from app.services.receipt_parse_job_service import (
    claim_parse_job,
    get_or_create_parse_job,
    get_parse_job_for_bill,
    job_to_status_payload,
)
from app.services.receipt_parser_service import ReceiptParserService
from app.workers.receipt_parse_worker import run_receipt_parse_job

router = APIRouter(prefix="/bills/{bill_id}/receipt", tags=["Receipts"])


@router.post("/upload", status_code=201)
async def upload_receipt(
    bill_id: uuid.UUID,
    append: bool = Query(
        False,
        description="If true, append these files to an existing receipt (sequential uploads).",
    ),
    file: UploadFile | None = File(None),
    files: list[UploadFile] | None = File(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = ReceiptParserService(db)
    uploads: list[UploadFile] = []
    if files:
        uploads.extend(files)
    if file:
        uploads.append(file)
    if not uploads:
        return error_response("UPLOAD_ERROR", "At least one file is required", 400)

    tuples: list[tuple[bytes, str, str]] = []
    for uf in uploads:
        content = await uf.read()
        tuples.append(
            (
                content,
                uf.filename or "receipt",
                uf.content_type or "application/octet-stream",
            )
        )
    try:
        receipt = svc.save_upload_files(
            bill_id=str(bill_id), files=tuples, append=append
        )
    except ValueError as e:
        return error_response("UPLOAD_ERROR", str(e), 400)

    return success_response(
        data=receipt_upload_to_out(receipt).model_dump(),
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

    return success_response(data=receipt_upload_to_out(receipt).model_dump())


@router.post("/parse")
def parse_receipt(
    bill_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    sync: bool = Query(
        False,
        description="If true, parse synchronously and return ParsedReceipt (legacy clients).",
    ),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if sync:
        svc = ReceiptParserService(db)
        try:
            parsed = svc.parse_receipt(str(bill_id))
        except ValueError as e:
            return error_response("PARSE_ERROR", str(e), 400)

        return success_response(
            data=parsed.model_dump(mode="json", exclude_none=True),
            message="Receipt parsed successfully",
        )

    job = get_or_create_parse_job(db, bill_id=bill_id, idempotency_key=idempotency_key)
    if job.status == "queued":
        if claim_parse_job(db, job.id):
            if settings.CELERY_BROKER_URL:
                from app.celery_app import parse_receipt_celery_task

                parse_receipt_celery_task.delay(str(job.id))
            else:
                background_tasks.add_task(run_receipt_parse_job, str(job.id))
    db.refresh(job)

    payload = {"job_id": str(job.id), "status": job.status}
    if job.status == "completed" and job.result_json:
        payload["result"] = job.result_json

    return success_response(data=payload, message="Parse job accepted")


@router.get("/parse-status/{job_id}")
def get_parse_status(
    bill_id: uuid.UUID,
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    job = get_parse_job_for_bill(db, bill_id=bill_id, job_id=job_id)
    if not job:
        return error_response("NOT_FOUND", "Parse job not found", 404)

    return success_response(data=job_to_status_payload(job))


@router.post("/items/sync")
def sync_receipt_items(
    bill_id: uuid.UUID,
    body: ReceiptItemSyncRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = ReceiptParserService(db)
    try:
        result = svc.sync_items(
            str(bill_id),
            body.model_dump(),
            user_id=str(current_user.id),
        )
    except ValueError as e:
        return error_response("BAD_REQUEST", str(e), 400)

    return success_response(
        data={
            "bill": BillOut.model_validate(result["bill"]).model_dump(),
            "items": [ReceiptItemOut.model_validate(item).model_dump() for item in result["items"]],
        },
        message="Receipt items synced",
    )


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
        item = svc.update_item(
            str(item_id),
            body.model_dump(exclude_unset=True),
            user_id=str(current_user.id),
        )
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
