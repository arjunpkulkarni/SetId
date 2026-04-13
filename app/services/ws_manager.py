"""In-process WebSocket connection manager for per-bill broadcast channels."""

import json
import logging
from collections import defaultdict

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class BillWSManager:
    """Tracks active WebSocket connections per bill and broadcasts events."""

    def __init__(self):
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)

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
        payload = json.dumps({"event": event, "data": data})
        dead: list[WebSocket] = []
        for ws in self._connections.get(bill_id, set()):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._connections[bill_id].discard(ws)

    def client_count(self, bill_id: str) -> int:
        return len(self._connections.get(bill_id, set()))


bill_ws_manager = BillWSManager()
