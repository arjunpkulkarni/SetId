"""Runs a receipt parse job (OCR → pre-parser → LLM → validation)."""

from __future__ import annotations

import logging
import uuid

from app.db.session import SessionLocal
from app.models.receipt_parse_job import ReceiptParseJob
from app.services.receipt_parse_job_service import (
    claim_parse_job,
    mark_job_completed,
    mark_job_failed,
)
from app.services.receipt_parser_service import ReceiptParserService

logger = logging.getLogger(__name__)


def run_receipt_parse_job(job_id: str) -> None:
    """Execute parse for `job_id`; updates job row in DB."""
    db = SessionLocal()
    try:
        jid = uuid.UUID(job_id)
        job = db.query(ReceiptParseJob).filter(ReceiptParseJob.id == jid).first()
        if not job:
            logger.warning("Parse job not found: %s", job_id)
            return
        if job.status in ("completed", "failed"):
            return

        if job.status == "queued":
            if not claim_parse_job(db, job.id):
                return
        elif job.status != "processing":
            return

        bill_id = job.bill_id

        svc = ReceiptParserService(db)
        parsed = svc.parse_receipt(str(bill_id))
        result = parsed.model_dump(mode="json", exclude_none=True)
        mark_job_completed(db, job, result)
    except Exception as exc:
        logger.exception("Parse job failed: %s", job_id)
        try:
            jid = uuid.UUID(job_id)
            job = db.query(ReceiptParseJob).filter(ReceiptParseJob.id == jid).first()
            if job and job.status not in ("completed",):
                mark_job_failed(db, job, str(exc))
        except Exception:
            db.rollback()
    finally:
        db.close()
