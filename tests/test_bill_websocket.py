"""Tests for the bill WebSocket endpoint and BillWSManager."""

import json
from unittest.mock import MagicMock, patch, AsyncMock

import pytest

from app.services.ws_manager import BillWSManager


# ---------------------------------------------------------------------------
# BillWSManager unit tests
# ---------------------------------------------------------------------------
class TestBillWSManager:
    @pytest.mark.asyncio
    async def test_connect_and_client_count(self):
        mgr = BillWSManager()
        ws = AsyncMock()
        await mgr.connect("bill-1", ws)

        ws.accept.assert_awaited_once()
        assert mgr.client_count("bill-1") == 1

    @pytest.mark.asyncio
    async def test_disconnect_removes_client(self):
        mgr = BillWSManager()
        ws = AsyncMock()
        await mgr.connect("bill-1", ws)

        mgr.disconnect("bill-1", ws)
        assert mgr.client_count("bill-1") == 0

    @pytest.mark.asyncio
    async def test_disconnect_nonexistent_is_safe(self):
        mgr = BillWSManager()
        ws = AsyncMock()
        mgr.disconnect("bill-1", ws)
        assert mgr.client_count("bill-1") == 0

    @pytest.mark.asyncio
    async def test_broadcast_sends_to_all_clients(self):
        mgr = BillWSManager()
        ws1 = AsyncMock()
        ws2 = AsyncMock()
        await mgr.connect("bill-1", ws1)
        await mgr.connect("bill-1", ws2)

        await mgr.broadcast("bill-1", "assignment_update", [{"id": "a1"}])

        expected = json.dumps({"event": "assignment_update", "data": [{"id": "a1"}]})
        ws1.send_text.assert_awaited_once_with(expected)
        ws2.send_text.assert_awaited_once_with(expected)

    @pytest.mark.asyncio
    async def test_broadcast_removes_dead_clients(self):
        mgr = BillWSManager()
        ws_alive = AsyncMock()
        ws_dead = AsyncMock()
        ws_dead.send_text.side_effect = RuntimeError("connection closed")

        await mgr.connect("bill-1", ws_alive)
        await mgr.connect("bill-1", ws_dead)
        assert mgr.client_count("bill-1") == 2

        await mgr.broadcast("bill-1", "assignment_update", [])

        assert mgr.client_count("bill-1") == 1

    @pytest.mark.asyncio
    async def test_broadcast_to_empty_bill_is_noop(self):
        mgr = BillWSManager()
        await mgr.broadcast("bill-no-one", "assignment_update", [])

    @pytest.mark.asyncio
    async def test_multiple_bills_isolated(self):
        mgr = BillWSManager()
        ws1 = AsyncMock()
        ws2 = AsyncMock()
        await mgr.connect("bill-1", ws1)
        await mgr.connect("bill-2", ws2)

        await mgr.broadcast("bill-1", "assignment_update", [{"bill": "1"}])

        ws1.send_text.assert_awaited_once()
        ws2.send_text.assert_not_awaited()


# ---------------------------------------------------------------------------
# WebSocket endpoint auth tests
# ---------------------------------------------------------------------------
class TestBillWSEndpoint:
    def test_rejects_invalid_token(self):
        from fastapi.testclient import TestClient
        from app.main import app

        client = TestClient(app)
        with pytest.raises(Exception):
            with client.websocket_connect("/bills/bill-1/ws?token=bad-token"):
                pass

    def test_rejects_missing_token(self):
        from fastapi.testclient import TestClient
        from app.main import app

        client = TestClient(app)
        with pytest.raises(Exception):
            with client.websocket_connect("/bills/bill-1/ws"):
                pass

    def test_rejects_non_participant(self):
        from fastapi.testclient import TestClient
        from app.main import app

        with patch("app.api.routes.bill_ws.decode_access_token", return_value="user-1"), \
             patch("app.api.routes.bill_ws.SessionLocal") as MockSession:
            db = MagicMock()
            user = MagicMock()
            user.id = "user-1"
            db.query.return_value.filter.return_value.first.return_value = user
            MockSession.return_value = db

            with patch("app.api.routes.bill_ws.require_bill_participant", side_effect=ValueError("FORBIDDEN")):
                client = TestClient(app)
                with pytest.raises(Exception):
                    with client.websocket_connect("/bills/bill-1/ws?token=valid"):
                        pass

    def test_accepts_valid_participant(self):
        from fastapi.testclient import TestClient
        from app.main import app

        with patch("app.api.routes.bill_ws.decode_access_token", return_value="user-1"), \
             patch("app.api.routes.bill_ws.SessionLocal") as MockSession, \
             patch("app.api.routes.bill_ws.require_bill_participant"):
            db = MagicMock()
            user = MagicMock()
            user.id = "user-1"
            db.query.return_value.filter.return_value.first.return_value = user
            MockSession.return_value = db

            client = TestClient(app)
            with client.websocket_connect("/bills/bill-1/ws?token=valid") as ws:
                assert ws is not None
