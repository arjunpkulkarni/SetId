import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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
    dashboard,
    invites,
    notifications,
)

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Backend API for WealthSplit — a bill-splitting application",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
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
app.include_router(dashboard.router)
app.include_router(invites.router)
app.include_router(notifications.router)


@app.get("/health", tags=["health"])
def health_check():
    return {"status": "healthy", "service": settings.PROJECT_NAME}
