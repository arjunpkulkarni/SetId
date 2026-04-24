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


@celery_app.task(name="notifications.request_payment_sms")
def request_payment_sms_task(bill_id: str, owner_id: str) -> None:
    """Twilio calls can take 500ms-2s each; running them on the HTTP worker
    (even via FastAPI BackgroundTasks) delays subsequent broadcasts queued
    on the same request. Offloading to Celery keeps the event loop hot."""
    import logging

    from app.db.session import SessionLocal
    from app.services.payment_notification_service import PaymentNotificationService

    logger = logging.getLogger(__name__)
    db = SessionLocal()
    try:
        PaymentNotificationService(db).sync_request_sms_for_bill(bill_id, owner_id)
    except Exception:
        logger.exception("Payment notification SMS failed for bill %s", bill_id)
    finally:
        db.close()
