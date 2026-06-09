"""Shared rate limiter.

When ``REDIS_URL`` (or ``CELERY_BROKER_URL``) is set, slowapi stores
counters in Redis so the limit is enforced *across* uvicorn workers and
across instances. Without that, each worker has its own counters, and a
4-worker pod with a stated "10 req/min" limit actually allows 40.

Falls back to the in-memory backend silently if redis isn't reachable —
we'd rather rate-limit-per-process than 500 the request.
"""

from __future__ import annotations

import logging

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

from app.core.config import settings

logger = logging.getLogger(__name__)


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    if request.client:
        return request.client.host
    return get_remote_address(request)


def _resolve_storage_uri() -> str | None:
    # Prefer an explicit limiter URL when set so we can isolate counters
    # on a different Redis DB if the broker becomes hot.
    if settings.RATE_LIMIT_REDIS_URL:
        return settings.RATE_LIMIT_REDIS_URL
    # Otherwise reuse the celery broker — same Redis instance is fine,
    # slowapi namespaces its keys with a ``LIMITER/`` prefix.
    return settings.CELERY_BROKER_URL or None


_storage_uri = _resolve_storage_uri()

try:
    if _storage_uri:
        limiter = Limiter(
            key_func=_client_ip,
            storage_uri=_storage_uri,
            # ``moving-window`` is more accurate than ``fixed-window`` for
            # bursty traffic (no per-minute boundary cliff), and Redis is
            # the only backend that supports it without a memory leak.
            strategy="moving-window",
            # Our routes return plain dicts via success_response(), not
            # starlette.Response — headers_enabled=True crashes slowapi.
            headers_enabled=False,
        )
        logger.info("event=limiter.init backend=redis storage_uri=%s", _storage_uri)
    else:
        limiter = Limiter(key_func=_client_ip, headers_enabled=False)
        logger.info("event=limiter.init backend=in-memory")
except Exception:  # pragma: no cover - defensive fallback
    logger.exception("event=limiter.init.failed_falling_back_to_memory")
    limiter = Limiter(key_func=_client_ip, headers_enabled=False)
