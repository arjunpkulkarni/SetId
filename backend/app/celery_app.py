"""Celery app for async receipt jobs (optional; requires CELERY_BROKER_URL)."""

from celery import Celery

from app.core.config import settings

celery_app = Celery(
    "wealthsplit",
    broker=settings.CELERY_BROKER_URL or "redis://localhost:6379/0",
    backend=settings.CELERY_RESULT_BACKEND or settings.CELERY_BROKER_URL,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
)


@celery_app.task(name="receipt.parse_receipt")
def parse_receipt_celery_task(job_id: str) -> None:
    from app.workers.receipt_parse_worker import run_receipt_parse_job

    run_receipt_parse_job(job_id)
