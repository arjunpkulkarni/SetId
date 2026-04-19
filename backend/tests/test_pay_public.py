"""Tests for the public pay link endpoint, including 20-minute TTL."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

from app.api.routes.pay_public import _token_expired


class TestTokenExpired:
    def test_fresh_token_not_expired(self):
        payment = MagicMock()
        payment.created_at = datetime.now(timezone.utc) - timedelta(minutes=5)

        with patch("app.api.routes.pay_public.settings") as s:
            s.PAY_LINK_TTL_MINUTES = 20
            assert _token_expired(payment) is False

    def test_old_token_expired(self):
        payment = MagicMock()
        payment.created_at = datetime.now(timezone.utc) - timedelta(minutes=25)

        with patch("app.api.routes.pay_public.settings") as s:
            s.PAY_LINK_TTL_MINUTES = 20
            assert _token_expired(payment) is True

    def test_just_under_boundary_not_expired(self):
        payment = MagicMock()
        payment.created_at = datetime.now(timezone.utc) - timedelta(minutes=19, seconds=59)

        with patch("app.api.routes.pay_public.settings") as s:
            s.PAY_LINK_TTL_MINUTES = 20
            assert _token_expired(payment) is False

    def test_ttl_zero_disables_expiry(self):
        payment = MagicMock()
        payment.created_at = datetime.now(timezone.utc) - timedelta(hours=48)

        with patch("app.api.routes.pay_public.settings") as s:
            s.PAY_LINK_TTL_MINUTES = 0
            assert _token_expired(payment) is False

    def test_naive_datetime_treated_as_utc(self):
        payment = MagicMock()
        payment.created_at = datetime.utcnow() - timedelta(minutes=25)

        with patch("app.api.routes.pay_public.settings") as s:
            s.PAY_LINK_TTL_MINUTES = 20
            assert _token_expired(payment) is True

    def test_none_created_at_not_expired(self):
        payment = MagicMock()
        payment.created_at = None

        with patch("app.api.routes.pay_public.settings") as s:
            s.PAY_LINK_TTL_MINUTES = 20
            assert _token_expired(payment) is False


class TestPayEndpointTTL:
    def test_expired_token_returns_410(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.db.session import get_db

        mock_db = MagicMock()
        app.dependency_overrides[get_db] = lambda: mock_db

        old_payment = MagicMock()
        old_payment.id = "pay-1"
        old_payment.status = "pending"
        old_payment.created_at = datetime.now(timezone.utc) - timedelta(minutes=30)
        old_payment.amount = Decimal("25.00")
        old_payment.currency = "USD"
        old_payment.bill = MagicMock()

        with patch("app.api.routes.pay_public.PaymentService") as MockSvc, \
             patch("app.api.routes.pay_public.settings") as s:
            s.PAY_LINK_TTL_MINUTES = 20
            MockSvc.return_value.get_payment_by_link_token.return_value = old_payment

            client = TestClient(app)
            resp = client.get("/pay/tok_expired123")

            assert resp.status_code == 410
            body = resp.json()
            assert body["error"]["code"] == "TOKEN_EXPIRED"

        app.dependency_overrides.clear()

    def test_fresh_token_returns_200(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.db.session import get_db
        import uuid

        mock_db = MagicMock()
        app.dependency_overrides[get_db] = lambda: mock_db

        payment = MagicMock()
        payment.id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        payment.status = "pending"
        payment.created_at = datetime.now(timezone.utc) - timedelta(minutes=5)
        payment.amount = Decimal("25.00")
        payment.currency = "USD"
        payment.stripe_client_secret = "pi_mock_secret"
        payment.stripe_payment_intent_id = "pi_mock_123"
        payment.payment_link_token = "tok_fresh"

        bill = MagicMock()
        bill.title = "Dinner"
        payment.bill = bill

        with patch("app.api.routes.pay_public.PaymentService") as MockSvc, \
             patch("app.api.routes.pay_public.settings") as s:
            s.PAY_LINK_TTL_MINUTES = 20
            s.PUBLIC_PAYMENT_BASE_URL = "https://app.wealthsplit.com"
            MockSvc.return_value.get_payment_by_link_token.return_value = payment
            MockSvc.return_value.ensure_stripe_client_for_payment.return_value = None

            client = TestClient(app)
            resp = client.get("/pay/tok_fresh")

            assert resp.status_code == 200
            data = resp.json()["data"]
            assert data["status"] == "pending"
            assert data["stripe_client_secret"] == "pi_mock_secret"

        app.dependency_overrides.clear()

    def test_succeeded_payment_skips_ttl_check(self):
        """Already-paid links should show the success message, not TOKEN_EXPIRED."""
        from fastapi.testclient import TestClient
        from app.main import app
        from app.db.session import get_db

        mock_db = MagicMock()
        app.dependency_overrides[get_db] = lambda: mock_db

        payment = MagicMock()
        payment.id = "pay-1"
        payment.status = "succeeded"
        payment.created_at = datetime.now(timezone.utc) - timedelta(hours=2)
        payment.amount = Decimal("25.00")
        payment.currency = "USD"

        bill = MagicMock()
        bill.title = "Lunch"
        payment.bill = bill

        with patch("app.api.routes.pay_public.PaymentService") as MockSvc, \
             patch("app.api.routes.pay_public.settings") as s:
            s.PAY_LINK_TTL_MINUTES = 20
            MockSvc.return_value.get_payment_by_link_token.return_value = payment

            client = TestClient(app)
            resp = client.get("/pay/tok_old_but_paid")

            assert resp.status_code == 200
            data = resp.json()["data"]
            assert data["status"] == "succeeded"

        app.dependency_overrides.clear()
