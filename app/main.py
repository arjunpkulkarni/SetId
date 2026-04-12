import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.middleware.error_handler import register_error_handlers
from app.api.routes import (
    auth,
    users,
    bills,
    members,
    receipts,
    assignments,
    payments,
    dashboard,
    invites,
    notifications,
    pay_public,
    internal_jobs,
)
from app.models import sms_log  # noqa: F401 — register SmsLog metadata

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    sched = None
    if settings.REMINDER_JOB_INTERVAL_SEC > 0:
        try:
            from apscheduler.schedulers.background import BackgroundScheduler

            from app.services.reminder_service import run_reminders_job
        except ImportError:
            logger.warning(
                "APScheduler not installed; in-process payment reminders disabled. "
                "Rebuild the Docker image (pip install -r requirements.txt) or run: "
                "docker compose build --no-cache api"
            )
        else:
            sched = BackgroundScheduler(daemon=True)
            sched.add_job(
                run_reminders_job,
                "interval",
                seconds=settings.REMINDER_JOB_INTERVAL_SEC,
                id="payment_reminders",
                replace_existing=True,
            )
            sched.start()
    yield
    if sched is not None:
        sched.shutdown(wait=False)


app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Backend API for WealthSplit — a bill-splitting application",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_error_handlers(app)

os.makedirs(settings.UPLOAD_DIR, exist_ok=True)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(bills.router)
app.include_router(members.router)
app.include_router(receipts.router)
app.include_router(assignments.router)
app.include_router(payments.router)
app.include_router(dashboard.router)
app.include_router(invites.router)
app.include_router(notifications.router)
app.include_router(pay_public.router)
app.include_router(internal_jobs.router)


@app.get("/health", tags=["health"])
def health_check():
    return {"status": "healthy", "service": settings.PROJECT_NAME}
