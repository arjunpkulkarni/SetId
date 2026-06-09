"""Celery app + queues for async receipt parsing and SMS fan-out.

Why dedicated queues:
    Receipts and SMS both make HTTP calls that can stall (vision API
    5-30s, Twilio 0.5-2s per send). On a single shared queue, a burst of
    SMS sends will block every parse worker behind them, and the user
    sees "parse pending" for 30+ seconds even though nothing is actually
    parsing. Splitting into ``parse`` and ``sms`` queues with their own
    workers eliminates head-of-line blocking.

Worker settings that matter for latency:
    * ``worker_prefetch_multiplier = 1`` — without this, a worker grabs
      up to 4 tasks at once and the 4th sits idle in the worker's local
      buffer while the redis queue *looks* empty. We want the broker to
      hand each task to the first free worker, period.
    * ``task_acks_late = True`` — only ack after the task completes, so
      if a worker dies mid-parse the task is re-queued instead of lost.
    * Threads pool (set via CLI) — receipt parsing is I/O-bound (vision
      API, DB), so threads scale better than forking and don't blow up
      memory the way ``--pool=prefork --concurrency=8`` does.
"""

import logging
import time

from celery import Celery
from celery.signals import task_failure, task_postrun, task_prerun
from kombu import Queue

from app.core.config import settings

logger = logging.getLogger("celery.tasks")

PARSE_QUEUE = "parse"
SMS_QUEUE = "sms"
DEFAULT_QUEUE = "default"

_BROKER_URL = settings.CELERY_BROKER_URL or "redis://localhost:6379/0"
_RESULT_BACKEND = (
    settings.CELERY_RESULT_BACKEND or settings.CELERY_BROKER_URL or "redis://localhost:6379/0"
)


celery_app = Celery(
    "wealthsplit",
    broker=_BROKER_URL,
    backend=_RESULT_BACKEND,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    # ─── Queues ───────────────────────────────────────────────────────
    task_default_queue=DEFAULT_QUEUE,
    task_queues=(
        Queue(PARSE_QUEUE, routing_key="parse.#"),
        Queue(SMS_QUEUE, routing_key="sms.#"),
        Queue(DEFAULT_QUEUE, routing_key="default.#"),
    ),
    task_routes={
        "receipt.parse_receipt": {"queue": PARSE_QUEUE, "routing_key": "parse.receipt"},
        "notifications.request_payment_sms": {
            "queue": SMS_QUEUE,
            "routing_key": "sms.payment_request",
        },
    },
    # ─── Reliability ──────────────────────────────────────────────────
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_track_started=True,
    # ─── Latency under load ───────────────────────────────────────────
    # One task at a time per worker process; let redis distribute. This
    # is what "make the parse instant when 100 people upload" buys you.
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
    broker_pool_limit=20,
    # Don't keep result rows forever; the DB row is the source of truth.
    result_expires=3600,
    # Cap a runaway parse so a bad image can't pin a worker.
    task_soft_time_limit=120,
    task_time_limit=180,
    # Sane SMS timeout — Twilio should never take this long.
    task_annotations={
        "notifications.request_payment_sms": {
            "soft_time_limit": 30,
            "time_limit": 45,
            # Retry transient Twilio errors with exponential backoff.
            "max_retries": 3,
            "default_retry_delay": 2,
        },
    },
)


# ─── Structured task timing (one log line per task lifecycle) ─────────
#
# Stored on the task's request stash via a private attribute so we
# don't depend on Celery's eventing system being on. Compatible with
# any pool (prefork/threads/gevent).

_TASK_START_ATTR = "_ws_t0"


@task_prerun.connect
def _on_task_prerun(sender=None, task_id=None, task=None, **_):
    if task is not None:
        setattr(task.request, _TASK_START_ATTR, time.perf_counter())
    logger.info(
        "event=celery.task.start task=%s task_id=%s queue=%s",
        getattr(task, "name", "?"),
        task_id,
        getattr(getattr(task, "request", None), "delivery_info", {}).get("routing_key"),
    )


@task_postrun.connect
def _on_task_postrun(sender=None, task_id=None, task=None, state=None, **_):
    t0 = getattr(getattr(task, "request", None), _TASK_START_ATTR, None)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0 if t0 else -1.0
    logger.info(
        "event=celery.task.end task=%s task_id=%s state=%s elapsed_ms=%.1f",
        getattr(task, "name", "?"),
        task_id,
        state,
        elapsed_ms,
    )


@task_failure.connect
def _on_task_failure(sender=None, task_id=None, exception=None, **_):
    logger.warning(
        "event=celery.task.failure task=%s task_id=%s error=%s",
        getattr(sender, "name", "?"),
        task_id,
        type(exception).__name__ if exception else "?",
    )


# ─── Tasks ────────────────────────────────────────────────────────────


@celery_app.task(name="receipt.parse_receipt", bind=True, max_retries=2, default_retry_delay=3)
def parse_receipt_celery_task(self, job_id: str) -> None:
    """Receipt parse pipeline (OCR → preparse → LLM → validation).

    Runs on the dedicated ``parse`` queue so it never queues behind SMS.
    """
    from app.utils.timing import Timer
    from app.workers.receipt_parse_worker import run_receipt_parse_job

    with Timer("celery.parse_receipt", log=logger, job_id=job_id, attempt=self.request.retries + 1):
        try:
            run_receipt_parse_job(job_id)
        except Exception as exc:
            logger.exception("event=celery.parse_receipt.exception job_id=%s", job_id)
            try:
                raise self.retry(exc=exc)
            except self.MaxRetriesExceededError:
                raise


@celery_app.task(name="notifications.request_payment_sms", bind=True)
def request_payment_sms_task(self, bill_id: str, owner_id: str) -> None:
    """Twilio calls (500ms-2s each) on a dedicated queue.

    Running them on the HTTP worker (even via FastAPI ``BackgroundTasks``)
    delays subsequent broadcasts queued on the same request. Offloading
    here keeps the event loop hot and lets us scale SMS concurrency
    independently of receipt parsing.
    """
    from app.db.session import SessionLocal
    from app.services.payment_notification_service import PaymentNotificationService
    from app.utils.timing import Timer

    with Timer("celery.request_payment_sms", log=logger, bill_id=bill_id, owner_id=owner_id):
        db = SessionLocal()
        try:
            PaymentNotificationService(db).sync_request_sms_for_bill(bill_id, owner_id)
        except Exception:
            logger.exception("event=celery.request_payment_sms.exception bill_id=%s", bill_id)
        finally:
            db.close()
