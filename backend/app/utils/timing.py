"""Structured timing helpers for hot paths (receipt parse, Celery tasks, SMS).

Use the ``Timer`` context manager around a block, or the ``timed`` decorator
on a function. Both emit a single structured log line on exit:

    event=<name> elapsed_ms=<float> ok=<bool> key1=val1 key2=val2 ...

The log line shape is intentionally grep/Loki/Datadog-friendly: every field
is ``key=value`` so it can be parsed without regex. Failures still log so
we can see "this thing took 4500ms then blew up" without digging through
exception traces.
"""

from __future__ import annotations

import functools
import logging
import time
from contextlib import AbstractContextManager
from typing import Any, Callable, TypeVar

logger = logging.getLogger("timing")

F = TypeVar("F", bound=Callable[..., Any])


def _fmt_fields(fields: dict[str, Any]) -> str:
    parts: list[str] = []
    for k, v in fields.items():
        if v is None:
            continue
        s = str(v)
        if " " in s or "=" in s:
            s = s.replace('"', "'")
            parts.append(f'{k}="{s}"')
        else:
            parts.append(f"{k}={s}")
    return " ".join(parts)


class Timer(AbstractContextManager["Timer"]):
    """Context manager that logs ``elapsed_ms`` when it exits.

    >>> with Timer("receipt.parse", bill_id=str(bill.id)) as t:
    ...     do_work()
    ...     t.add(items=len(parsed.items))
    """

    __slots__ = ("event", "fields", "_t0", "elapsed_ms", "logger")

    def __init__(
        self,
        event: str,
        *,
        log: logging.Logger | None = None,
        **fields: Any,
    ) -> None:
        self.event = event
        self.fields: dict[str, Any] = dict(fields)
        self._t0 = 0.0
        self.elapsed_ms = 0.0
        self.logger = log or logger

    def __enter__(self) -> "Timer":
        self._t0 = time.perf_counter()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.elapsed_ms = (time.perf_counter() - self._t0) * 1000.0
        ok = exc_type is None
        line = _fmt_fields(
            {
                "event": self.event,
                "elapsed_ms": f"{self.elapsed_ms:.1f}",
                "ok": str(ok).lower(),
                **self.fields,
                **({"error": exc_type.__name__} if exc_type else {}),
            }
        )
        if ok:
            self.logger.info(line)
        else:
            self.logger.warning(line)

    def add(self, **fields: Any) -> None:
        """Attach extra fields recorded mid-block (e.g. result counts)."""
        self.fields.update(fields)

    def lap(self, name: str, **fields: Any) -> float:
        """Log an intermediate checkpoint and return ms since entry."""
        ms = (time.perf_counter() - self._t0) * 1000.0
        line = _fmt_fields(
            {
                "event": f"{self.event}.{name}",
                "elapsed_ms": f"{ms:.1f}",
                **self.fields,
                **fields,
            }
        )
        self.logger.info(line)
        return ms


def timed(event: str | None = None, *, log: logging.Logger | None = None) -> Callable[[F], F]:
    """Decorator equivalent of ``Timer``.

    Logs ``event=<event or fn qualname> elapsed_ms=...`` on every call.
    """

    def decorator(fn: F) -> F:
        ev = event or fn.__qualname__

        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            with Timer(ev, log=log):
                return fn(*args, **kwargs)

        return wrapper  # type: ignore[return-value]

    return decorator
