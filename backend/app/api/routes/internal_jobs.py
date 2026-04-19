"""Internal maintenance jobs (cron / k8s CronJob)."""

import logging

from fastapi import APIRouter, Header

from app.core.config import settings
from app.core.response import error_response, success_response
from app.services.reminder_service import run_reminders_job

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal", tags=["Internal jobs"])


@router.post("/jobs/payment-reminders")
def trigger_payment_reminders(
    x_job_secret: str | None = Header(None, alias="X-Job-Secret"),
):
    """
    Run the unpaid-payment reminder cycle once.
    Requires INTERNAL_JOB_SECRET to be configured and matched via X-Job-Secret header.
    """
    if not settings.INTERNAL_JOB_SECRET:
        return error_response(
            "NOT_CONFIGURED",
            "INTERNAL_JOB_SECRET must be set to use this endpoint",
            503,
        )

    if x_job_secret != settings.INTERNAL_JOB_SECRET:
        return error_response("UNAUTHORIZED", "Invalid job secret", 401)

    run_reminders_job()
    return success_response(message="Payment reminder job completed")
