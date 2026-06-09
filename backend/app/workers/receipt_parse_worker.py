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
from app.utils.timing import Timer

logger = logging.getLogger(__name__)


def run_receipt_parse_job(job_id: str) -> None:
    """Execute parse for ``job_id``; updates job row in DB.

    Each phase is timed independently so we can see whether time is
    going to DB lookups, the vision API, the cleanup LLM, or validation.
    """
    with Timer("worker.parse_job", job_id=job_id) as t:
        db = SessionLocal()
        try:
            jid = uuid.UUID(job_id)
            with Timer("worker.parse_job.load", job_id=job_id):
                job = (
                    db.query(ReceiptParseJob)
                    .filter(ReceiptParseJob.id == jid)
                    .first()
                )
            if not job:
                logger.warning("event=worker.parse_job.missing job_id=%s", job_id)
                return
            if job.status in ("completed", "failed"):
                logger.info(
                    "event=worker.parse_job.skip job_id=%s status=%s",
                    job_id,
                    job.status,
                )
                return

            if job.status == "queued":
                if not claim_parse_job(db, job.id):
                    logger.info(
                        "event=worker.parse_job.lost_claim job_id=%s", job_id
                    )
                    return
            elif job.status != "processing":
                return

            bill_id = job.bill_id
            t.add(bill_id=str(bill_id))

            svc = ReceiptParserService(db)
            with Timer("worker.parse_job.pipeline", job_id=job_id, bill_id=str(bill_id)) as pt:
                parsed = svc.parse_receipt(str(bill_id))
                pt.add(items=len(parsed.items), total=str(parsed.total))

            result = parsed.model_dump(mode="json", exclude_none=True)
            with Timer("worker.parse_job.persist", job_id=job_id):
                mark_job_completed(db, job, result)
            t.add(items=len(parsed.items), ok="true")
        except Exception as exc:
            logger.exception("event=worker.parse_job.failed job_id=%s", job_id)
            t.add(ok="false", error=type(exc).__name__)
            try:
                jid = uuid.UUID(job_id)
                job = (
                    db.query(ReceiptParseJob)
                    .filter(ReceiptParseJob.id == jid)
                    .first()
                )
                if job and job.status != "completed":
                    mark_job_failed(db, job, str(exc))
            except Exception:
                db.rollback()
        finally:
            db.close()
