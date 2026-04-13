"""WebSocket endpoint for live bill assignment updates.

Frontend connects to:  ws://{host}/bills/{bill_id}/ws?token={jwt}

The server authenticates via the JWT query param, verifies the user is a
bill participant, then holds the connection open.  Assignment mutations
broadcast an `assignment_update` event to every connected client.
"""

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from starlette.websockets import WebSocketState

from app.core.security import decode_access_token
from app.db.session import SessionLocal
from app.models.user import User
from app.api.deps_bill import require_bill_participant
from app.services.ws_manager import bill_ws_manager

logger = logging.getLogger(__name__)

router = APIRouter()


@router.websocket("/bills/{bill_id}/ws")
async def bill_websocket(
    websocket: WebSocket,
    bill_id: str,
    token: str = Query(...),
):
    user_id = decode_access_token(token)
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
            await websocket.receive_text()
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
