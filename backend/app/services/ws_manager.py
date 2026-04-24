"""In-process WebSocket connection manager for per-bill broadcast channels.

When ``settings.WS_REDIS_URL`` is set the manager additionally publishes
every broadcast to Redis pub/sub and subscribes from all workers, so a
mutation hitting worker A still reaches sockets held by worker B. Without
Redis the manager is single-worker only — correct for dev, but broadcasts
silently drop between workers in a horizontally-scaled deploy.
"""

import asyncio
import json
import logging
import os
import uuid as _uuid
from collections import defaultdict
from typing import Coroutine

from fastapi import WebSocket

from app.core.config import settings

logger = logging.getLogger(__name__)

# Server-originated heartbeat cadence.
#
# Consumer NATs / mobile carriers routinely drop idle TCP flows after 60-120s.
# We ping every 15s so both sides have clear evidence of liveness well within
# that window, and so a single dropped ping doesn't immediately trip the
# client-side liveness timeout (which waits for 60s of silence).
HEARTBEAT_INTERVAL_SEC = 15
HEARTBEAT_PONG_TIMEOUT_SEC = 10

# Every worker gets its own id so broadcasts published to Redis by *this*
# worker can be identified in the fan-in subscriber and not re-broadcast
# locally (which would double-send to sockets that already received it on
# the publish path).
_WORKER_ID = f"{os.getpid()}-{_uuid.uuid4().hex[:8]}"
_REDIS_CHANNEL = "setid:ws:broadcast"

# The asyncio loop running FastAPI. Captured from `main.py` on startup so
# sync request handlers (the default for non-`async def` endpoints) can
# schedule broadcasts onto the loop instead of queuing them behind
# `BackgroundTasks` (which only runs *after* the response has been sent).
_main_loop: asyncio.AbstractEventLoop | None = None


def register_main_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _main_loop
    _main_loop = loop


def schedule_broadcast(coro: Coroutine) -> None:
    """Fire-and-forget a broadcast coroutine onto the main event loop.

    Works from either an async context (uses the running loop) or from a
    sync FastAPI endpoint running in the threadpool (uses the captured
    main loop). Falls back to closing the coroutine if no loop is available
    so we never leak an un-awaited coroutine warning."""
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(coro)
        return
    except RuntimeError:
        pass

    if _main_loop is not None and not _main_loop.is_closed():
        asyncio.run_coroutine_threadsafe(coro, _main_loop)
        return

    logger.warning("schedule_broadcast: no event loop available; dropping broadcast")
    coro.close()


class BillWSManager:
    """Tracks active WebSocket connections per bill and broadcasts events."""

    def __init__(self):
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._heartbeat_task: asyncio.Task | None = None
        self._redis = None
        self._redis_pubsub = None
        self._redis_subscriber_task: asyncio.Task | None = None

    async def connect(self, bill_id: str, ws: WebSocket):
        await ws.accept()
        self._connections[bill_id].add(ws)
        logger.info("ws_connected", extra={"bill_id": bill_id, "clients": len(self._connections[bill_id])})

    def disconnect(self, bill_id: str, ws: WebSocket):
        self._connections[bill_id].discard(ws)
        if not self._connections[bill_id]:
            del self._connections[bill_id]
        logger.info("ws_disconnected", extra={"bill_id": bill_id})

    async def _local_broadcast(self, bill_id: str, event: str, data: list | dict) -> None:
        payload = json.dumps({"type": event, "data": data})
        clients = list(self._connections.get(bill_id, set()))
        logger.info(
            "ws_broadcast bill=%s event=%s clients=%d",
            bill_id,
            event,
            len(clients),
        )
        if not clients:
            return

        # Fan out concurrently — one slow socket must not serialize the
        # broadcast to everyone else.
        async def _send(sock: WebSocket) -> WebSocket | None:
            try:
                await sock.send_text(payload)
                return None
            except Exception:
                return sock

        results = await asyncio.gather(*(_send(ws) for ws in clients), return_exceptions=True)
        for res in results:
            if isinstance(res, WebSocket):
                self._connections[bill_id].discard(res)

    async def broadcast(self, bill_id: str, event: str, data: list | dict):
        """Broadcast locally AND (if Redis is configured) across workers."""
        # Publish first so remote workers start their fan-out in parallel
        # with ours. We don't await subscriber delivery — Redis publish is
        # fire-and-forget and typically sub-millisecond.
        if self._redis is not None:
            try:
                await self._redis.publish(
                    _REDIS_CHANNEL,
                    json.dumps({
                        "worker": _WORKER_ID,
                        "bill_id": bill_id,
                        "event": event,
                        "data": data,
                    }, default=str),
                )
            except Exception:
                logger.exception("redis publish failed; falling back to local only")

        await self._local_broadcast(bill_id, event, data)

    async def send_to(self, ws: WebSocket, msg: dict):
        try:
            await ws.send_text(json.dumps(msg))
        except Exception:
            pass

    def client_count(self, bill_id: str) -> int:
        return len(self._connections.get(bill_id, set()))

    async def start_redis(self) -> None:
        """Connect to Redis pub/sub and start the subscriber loop.

        Called from app startup. No-op when `WS_REDIS_URL` is unset."""
        url = settings.WS_REDIS_URL
        if not url:
            return
        try:
            import redis.asyncio as aioredis  # type: ignore
        except ImportError:
            logger.warning("WS_REDIS_URL set but redis.asyncio not available; skipping")
            return

        try:
            self._redis = aioredis.from_url(url, encoding="utf-8", decode_responses=True)
            self._redis_pubsub = self._redis.pubsub()
            await self._redis_pubsub.subscribe(_REDIS_CHANNEL)
            self._redis_subscriber_task = asyncio.create_task(self._run_redis_subscriber())
            logger.info("ws_redis_subscribed channel=%s worker=%s", _REDIS_CHANNEL, _WORKER_ID)
        except Exception:
            logger.exception("failed to connect to WS_REDIS_URL; running in single-worker mode")
            self._redis = None
            self._redis_pubsub = None

    async def stop_redis(self) -> None:
        if self._redis_subscriber_task is not None and not self._redis_subscriber_task.done():
            self._redis_subscriber_task.cancel()
            try:
                await self._redis_subscriber_task
            except (asyncio.CancelledError, Exception):
                pass
        if self._redis_pubsub is not None:
            try:
                await self._redis_pubsub.unsubscribe(_REDIS_CHANNEL)
                await self._redis_pubsub.close()
            except Exception:
                pass
        if self._redis is not None:
            try:
                await self._redis.close()
            except Exception:
                pass

    async def _run_redis_subscriber(self) -> None:
        """Relay published broadcasts from other workers to local sockets.

        Messages published by *this* worker are dropped on the fan-in side;
        we already sent them to local sockets on the publish path."""
        assert self._redis_pubsub is not None
        while True:
            try:
                msg = await self._redis_pubsub.get_message(
                    ignore_subscribe_messages=True,
                    timeout=1.0,
                )
                if msg is None:
                    continue
                try:
                    payload = json.loads(msg.get("data") or "{}")
                except Exception:
                    continue
                if payload.get("worker") == _WORKER_ID:
                    continue
                bill_id = payload.get("bill_id")
                event = payload.get("event")
                data = payload.get("data")
                if not bill_id or not event:
                    continue
                await self._local_broadcast(bill_id, event, data)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("redis subscriber error; retrying")
                await asyncio.sleep(1.0)

    async def start_heartbeat(self):
        """Run a periodic ping loop that detects and removes dead connections.

        Pings are dispatched concurrently so a half-dead socket can't block
        pings to other clients for the duration of the pong timeout."""
        self._heartbeat_task = asyncio.current_task()
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL_SEC)
            all_ws: list[tuple[str, WebSocket]] = []
            for bill_id, sockets in list(self._connections.items()):
                for ws in list(sockets):
                    all_ws.append((bill_id, ws))

            if not all_ws:
                continue

            async def _ping(bill_id: str, ws: WebSocket) -> tuple[str, WebSocket] | None:
                try:
                    await asyncio.wait_for(
                        ws.send_json({"type": "ping"}),
                        timeout=HEARTBEAT_PONG_TIMEOUT_SEC,
                    )
                    return None
                except Exception:
                    return (bill_id, ws)

            dead = await asyncio.gather(
                *(_ping(bid, ws) for bid, ws in all_ws),
                return_exceptions=True,
            )
            for entry in dead:
                if isinstance(entry, tuple):
                    bill_id, ws = entry
                    logger.debug("heartbeat_dead_connection", extra={"bill_id": bill_id})
                    self.disconnect(bill_id, ws)
                    try:
                        await ws.close(code=1001, reason="Heartbeat timeout")
                    except Exception:
                        pass

    def stop_heartbeat(self):
        if self._heartbeat_task and not self._heartbeat_task.done():
            self._heartbeat_task.cancel()


bill_ws_manager = BillWSManager()
