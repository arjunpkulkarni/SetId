import logging
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.config import settings
from app.middleware.error_handler import register_error_handlers
from app.limiter import limiter
from app.api.routes import (
    auth,
    users,
    bills,
    members,
    receipts,
    assignments,
    payments,
    payment_methods,
    dashboard,
    invites,
    invite_public,
    notifications,
    pay_public,
    party_public,
    internal_jobs,
    stripe_connect,
    virtual_cards,
    bill_ws,
    debug,
)
from app.models import sms_log  # noqa: F401 — register SmsLog metadata

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    from app.services.ws_manager import bill_ws_manager, register_main_loop

    # Capture the running loop so sync request handlers can schedule
    # broadcasts onto it via `schedule_broadcast(...)`. Without this, sync
    # endpoints would have to rely on BackgroundTasks, which only run after
    # the response is flushed (added 500-1500ms of fan-out delay).
    register_main_loop(asyncio.get_running_loop())

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

    # Connect to Redis pub/sub for cross-worker WS fan-out (no-op if
    # WS_REDIS_URL is unset). Must happen before the heartbeat starts so
    # remote broadcasts aren't missed during the window after the first
    # socket connects.
    await bill_ws_manager.start_redis()

    heartbeat_task = asyncio.create_task(bill_ws_manager.start_heartbeat())

    yield

    heartbeat_task.cancel()
    try:
        await heartbeat_task
    except asyncio.CancelledError:
        pass
    await bill_ws_manager.stop_redis()
    if sched is not None:
        sched.shutdown(wait=False)


_is_prod = settings.ENVIRONMENT.lower() == "production"

if _is_prod and settings.JWT_SECRET_KEY in ("dev-secret-change-me", ""):
    raise RuntimeError(
        "FATAL: JWT_SECRET_KEY must be changed from the default in production. "
        "Set a strong random secret via the JWT_SECRET_KEY environment variable."
    )

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Backend API for WealthSplit — a bill-splitting application",
    version="1.0.0",
    docs_url=None if _is_prod else "/docs",
    redoc_url=None if _is_prod else "/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    # Accept any `*.settld.live` subdomain (staging/preview deploys) without
    # needing to add each one to CORS_ORIGINS explicitly. Leaving the regex
    # empty disables this branch.
    allow_origin_regex=settings.CORS_ORIGIN_REGEX or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_error_handlers(app)

app.state.limiter = limiter

os.makedirs(settings.UPLOAD_DIR, exist_ok=True)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(bills.router)
app.include_router(members.router)
app.include_router(receipts.router)
app.include_router(assignments.router)
app.include_router(payments.router)
app.include_router(payment_methods.router)
app.include_router(dashboard.router)
app.include_router(invites.router)
app.include_router(invite_public.router)
app.include_router(notifications.router)
app.include_router(pay_public.router)
app.include_router(party_public.router)
app.include_router(internal_jobs.router)
app.include_router(stripe_connect.router)
app.include_router(virtual_cards.router)
app.include_router(bill_ws.router)
# Debug endpoints - disable in production
if not _is_prod:
    app.include_router(debug.router)

# Mount static files for web payment page
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/health", tags=["health"])
def health_check(db: Session = Depends(get_db)):
    try:
        from sqlalchemy import text
        db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False

    status = "healthy" if db_ok else "degraded"
    status_code = 200 if db_ok else 503
    return JSONResponse(
        status_code=status_code,
        content={
            "status": status,
            "service": settings.PROJECT_NAME,
            "database": "connected" if db_ok else "unreachable",
        },
    )
