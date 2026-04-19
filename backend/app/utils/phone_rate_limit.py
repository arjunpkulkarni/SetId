"""Simple in-memory rate limiter for OTP sends per phone (rolling window)."""

from __future__ import annotations

import time
from collections import defaultdict

from app.core.config import settings

_window_sec = 3600
_timestamps: dict[str, list[float]] = defaultdict(list)


def check_phone_send_limit(phone_e164: str) -> None:
    """
    Raises PermissionError with message if phone exceeded hourly send quota.
    """
    now = time.time()
    cutoff = now - _window_sec
    hist = _timestamps[phone_e164]
    hist[:] = [t for t in hist if t >= cutoff]
    max_sends = settings.OTP_MAX_SENDS_PER_PHONE_PER_HOUR
    if len(hist) >= max_sends:
        raise PermissionError(
            f"Too many codes sent to this number. Try again later."
        )
    hist.append(now)
