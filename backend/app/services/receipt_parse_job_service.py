"""DB-backed receipt parse jobs (async) with idempotency."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import and_, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.receipt_pipeline import RECEIPT_PIPELINE_VERSION
from app.models.receipt_parse_job import ReceiptParseJob


def get_or_create_parse_job(
    db: Session,
    *,
    bill_id: uuid.UUID,
    idempotency_key: str | None,
) -> ReceiptParseJob:
    if idempotency_key:
        existing = (
            db.query(ReceiptParseJob)
            .filter(
                ReceiptParseJob.bill_id == bill_id,
                ReceiptParseJob.idempotency_key == idempotency_key,
            )
            .first()
        )
        if existing:
            return existing

    job = ReceiptParseJob(
        bill_id=bill_id,
        status="queued",
        pipeline_version=RECEIPT_PIPELINE_VERSION,
        idempotency_key=idempotency_key,
    )
    db.add(job)
    try:
        db.commit()
        db.refresh(job)
        return job
    except IntegrityError:
        db.rollback()
        if idempotency_key:
            found = (
                db.query(ReceiptParseJob)
                .filter(
                    ReceiptParseJob.bill_id == bill_id,
                    ReceiptParseJob.idempotency_key == idempotency_key,
                )
                .first()
            )
            if found:
                return found
        raise


def get_parse_job_for_bill(
    db: Session, *, bill_id: uuid.UUID, job_id: uuid.UUID
) -> ReceiptParseJob | None:
    return (
        db.query(ReceiptParseJob)
        .filter(ReceiptParseJob.id == job_id, ReceiptParseJob.bill_id == bill_id)
        .first()
    )


def job_to_status_payload(job: ReceiptParseJob) -> dict:
    out: dict = {
        "job_id": str(job.id),
        "status": job.status,
        "pipeline_version": job.pipeline_version,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
    }
    if job.status == "failed":
        out["error"] = job.error_message
    if job.status == "completed" and job.result_json:
        out["result"] = job.result_json
    return out


def claim_parse_job(db: Session, job_id: uuid.UUID) -> bool:
    """Exactly one caller wins the transition queued → processing (idempotent enqueue)."""
    res = db.execute(
        update(ReceiptParseJob)
        .where(
            and_(
                ReceiptParseJob.id == job_id,
                ReceiptParseJob.status == "queued",
            )
        )
        .values(status="processing", updated_at=datetime.now(timezone.utc))
    )
    db.commit()
    return res.rowcount == 1


def mark_job_processing(db: Session, job: ReceiptParseJob) -> None:
    job.status = "processing"
    job.updated_at = datetime.now(timezone.utc)
    db.commit()


def mark_job_completed(db: Session, job: ReceiptParseJob, result: dict) -> None:
    now = datetime.now(timezone.utc)
    job.status = "completed"
    job.result_json = result
    job.error_message = None
    job.completed_at = now
    job.updated_at = now
    db.commit()


def mark_job_failed(db: Session, job: ReceiptParseJob, message: str) -> None:
    now = datetime.now(timezone.utc)
    job.status = "failed"
    job.error_message = message[:8000]
    job.completed_at = now
    job.updated_at = now
    db.commit()
