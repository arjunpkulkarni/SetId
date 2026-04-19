"""In-process WebSocket connection manager for per-bill broadcast channels."""

import asyncio
import json
import logging
from collections import defaultdict

from fastapi import WebSocket

logger = logging.getLogger(__name__)

HEARTBEAT_INTERVAL_SEC = 30
HEARTBEAT_PONG_TIMEOUT_SEC = 10


class BillWSManager:
    """Tracks active WebSocket connections per bill and broadcasts events."""

    def __init__(self):
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._heartbeat_task: asyncio.Task | None = None

    async def connect(self, bill_id: str, ws: WebSocket):
        await ws.accept()
        self._connections[bill_id].add(ws)
        logger.info("ws_connected", extra={"bill_id": bill_id, "clients": len(self._connections[bill_id])})

    def disconnect(self, bill_id: str, ws: WebSocket):
        self._connections[bill_id].discard(ws)
        if not self._connections[bill_id]:
            del self._connections[bill_id]
        logger.info("ws_disconnected", extra={"bill_id": bill_id})

    async def broadcast(self, bill_id: str, event: str, data: list | dict):
        payload = json.dumps({"type": event, "data": data})
        clients = self._connections.get(bill_id, set())
        logger.info(
            "ws_broadcast bill=%s event=%s clients=%d",
            bill_id,
            event,
            len(clients),
        )
        dead: list[WebSocket] = []
        for ws in clients:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._connections[bill_id].discard(ws)

    async def send_to(self, ws: WebSocket, msg: dict):
        try:
            await ws.send_text(json.dumps(msg))
        except Exception:
            pass

    def client_count(self, bill_id: str) -> int:
        return len(self._connections.get(bill_id, set()))

    async def start_heartbeat(self):
        """Run a periodic ping loop that detects and removes dead connections."""
        self._heartbeat_task = asyncio.current_task()
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL_SEC)
            all_ws: list[tuple[str, WebSocket]] = []
            for bill_id, sockets in list(self._connections.items()):
                for ws in list(sockets):
                    all_ws.append((bill_id, ws))

            for bill_id, ws in all_ws:
                try:
                    await asyncio.wait_for(
                        ws.send_json({"type": "ping"}),
                        timeout=HEARTBEAT_PONG_TIMEOUT_SEC,
                    )
                except Exception:
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
