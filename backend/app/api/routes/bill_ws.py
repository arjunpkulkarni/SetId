"""WebSocket endpoint for live bill assignment updates.

Frontend connects to:  wss://{host}/bills/{bill_id}/ws?token={jwt}

The server authenticates via the JWT query param, verifies the user is a
bill participant, then holds the connection open.  Assignment mutations
broadcast an `assignment_update` event to every connected client.
"""

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from starlette.websockets import WebSocketState

from app.core.config import settings
from app.core.security import decode_access_token
from app.db.session import SessionLocal
from app.models.user import User
from app.api.deps_bill import require_bill_participant
from app.services.ws_manager import bill_ws_manager

logger = logging.getLogger(__name__)

router = APIRouter()

_is_prod = settings.ENVIRONMENT.lower() == "production"

RECEIVE_TIMEOUT_SEC = 120


@router.websocket("/bills/{bill_id}/ws")
async def bill_websocket(
    websocket: WebSocket,
    bill_id: str,
    token: str = Query(...),
):
    if _is_prod and websocket.scope.get("scheme") not in ("wss", "ws+tls"):
        raw_headers = dict(websocket.scope.get("headers", []))
        forwarded_proto = raw_headers.get(b"x-forwarded-proto", b"").decode()
        if forwarded_proto != "https":
            await websocket.close(code=4002, reason="WSS required in production")
            return

    payload = decode_access_token(token)
    user_id = payload.get("sub") if payload else None
    if not user_id:
        await websocket.close(code=4001, reason="Invalid or expired token")
        return

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()
        if not user:
            await websocket.close(code=4001, reason="User not found")
            return

        try:
            require_bill_participant(db, bill_id, str(user.id))
        except ValueError:
            await websocket.close(code=4003, reason="Not a participant of this bill")
            return
    finally:
        db.close()

    await bill_ws_manager.connect(bill_id, websocket)
    try:
        while True:
            try:
                raw = await asyncio.wait_for(
                    websocket.receive_text(),
                    timeout=RECEIVE_TIMEOUT_SEC,
                )
            except asyncio.TimeoutError:
                continue

            try:
                msg = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                continue

            if msg.get("type") == "ping":
                await bill_ws_manager.send_to(websocket, {"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.debug("ws_unexpected_close", extra={"bill_id": bill_id})
    finally:
        bill_ws_manager.disconnect(bill_id, websocket)
        if websocket.client_state == WebSocketState.CONNECTED:
            try:
                await websocket.close()
            except Exception:
                pass
