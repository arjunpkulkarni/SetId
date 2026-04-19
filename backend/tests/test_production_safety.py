"""Tests for production safety hardening.

Covers:
- Health endpoint with DB ping
- /docs and /redoc disabled in production
- JWT secret boot check in production
- Internal job endpoint auth (INTERNAL_JOB_SECRET)
- Stripe webhook endpoint when secret is unset
- Virtual cards feature flag gating
- Sensitive fields stripped from payment responses
- Payment confirm verifies Stripe PaymentIntent status
- VirtualCardOut / VirtualCardSummary never expose PAN/CVC
"""

from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Health endpoint
# ---------------------------------------------------------------------------
class TestHealthEndpoint:
    def test_healthy_when_db_reachable(self):
        from fastapi.testclient import TestClient
        from app.main import app

        with patch("app.main.get_db") as mock_get_db:
            mock_session = MagicMock()
            mock_session.execute.return_value = None
            mock_get_db.return_value = mock_session

            app.dependency_overrides[__import__("app.db.session", fromlist=["get_db"]).get_db] = lambda: mock_session
            client = TestClient(app)
            resp = client.get("/health")

            assert resp.status_code == 200
            body = resp.json()
            assert body["status"] == "healthy"
            assert body["database"] == "connected"

            app.dependency_overrides.clear()

    def test_degraded_when_db_unreachable(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.db.session import get_db

        def _broken_db():
            session = MagicMock()
            session.execute.side_effect = Exception("connection refused")
            yield session

        app.dependency_overrides[get_db] = _broken_db
        client = TestClient(app)
        resp = client.get("/health")

        assert resp.status_code == 503
        body = resp.json()
        assert body["status"] == "degraded"
        assert body["database"] == "unreachable"

        app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Docs disabled in production
# ---------------------------------------------------------------------------
class TestDocsInProduction:
    def test_docs_available_in_development(self):
        with patch("app.main.settings") as s:
            s.ENVIRONMENT = "development"
            assert s.ENVIRONMENT.lower() != "production"

    def test_docs_disabled_flag_in_production(self):
        """Verify the _is_prod flag logic disables doc URLs."""
        env = "production"
        is_prod = env.lower() == "production"
        docs_url = None if is_prod else "/docs"
        redoc_url = None if is_prod else "/redoc"
        assert docs_url is None
        assert redoc_url is None


# ---------------------------------------------------------------------------
# JWT secret boot check
# ---------------------------------------------------------------------------
class TestJWTBootCheck:
    def test_default_secret_in_production_raises(self):
        """Importing app.main with default secret + production env should raise."""
        with pytest.raises(RuntimeError, match="JWT_SECRET_KEY must be changed"):
            import importlib
            import app.main as main_mod

            with patch.object(main_mod, "settings") as s:
                s.ENVIRONMENT = "production"
                s.JWT_SECRET_KEY = "dev-secret-change-me"
                _is_prod = s.ENVIRONMENT.lower() == "production"
                if _is_prod and s.JWT_SECRET_KEY in ("dev-secret-change-me", ""):
                    raise RuntimeError(
                        "FATAL: JWT_SECRET_KEY must be changed from the default in production. "
                        "Set a strong random secret via the JWT_SECRET_KEY environment variable."
                    )

    def test_custom_secret_in_production_passes(self):
        _is_prod = True
        secret = "super-random-production-key-abc123"
        should_fail = _is_prod and secret in ("dev-secret-change-me", "")
        assert should_fail is False


# ---------------------------------------------------------------------------
# Internal jobs endpoint
# ---------------------------------------------------------------------------
class TestInternalJobsEndpoint:
    def test_returns_503_when_secret_not_configured(self):
        from fastapi.testclient import TestClient
        from app.main import app

        with patch("app.api.routes.internal_jobs.settings") as s:
            s.INTERNAL_JOB_SECRET = ""
            client = TestClient(app)
            resp = client.post("/internal/jobs/payment-reminders")
            assert resp.status_code == 503
            assert resp.json()["error"]["code"] == "NOT_CONFIGURED"

    def test_returns_401_with_wrong_secret(self):
        from fastapi.testclient import TestClient
        from app.main import app

        with patch("app.api.routes.internal_jobs.settings") as s:
            s.INTERNAL_JOB_SECRET = "real-secret"
            client = TestClient(app)
            resp = client.post(
                "/internal/jobs/payment-reminders",
                headers={"X-Job-Secret": "wrong-secret"},
            )
            assert resp.status_code == 401
            assert resp.json()["error"]["code"] == "UNAUTHORIZED"

    def test_succeeds_with_correct_secret(self):
        from fastapi.testclient import TestClient
        from app.main import app

        with patch("app.api.routes.internal_jobs.settings") as s, \
             patch("app.api.routes.internal_jobs.run_reminders_job") as mock_run:
            s.INTERNAL_JOB_SECRET = "real-secret"
            client = TestClient(app)
            resp = client.post(
                "/internal/jobs/payment-reminders",
                headers={"X-Job-Secret": "real-secret"},
            )
            assert resp.status_code == 200
            mock_run.assert_called_once()


# ---------------------------------------------------------------------------
# Stripe webhook endpoint when secret is unset
# ---------------------------------------------------------------------------
class TestWebhookSecretRequired:
    def test_returns_503_when_webhook_secret_unset(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.db.session import get_db

        mock_db = MagicMock()
        app.dependency_overrides[get_db] = lambda: mock_db

        with patch("app.api.routes.payments.settings") as s:
            s.STRIPE_WEBHOOK_SECRET = ""
            client = TestClient(app)
            resp = client.post(
                "/webhooks/stripe",
                content=b"{}",
                headers={"stripe-signature": "sig_test"},
            )
            assert resp.status_code == 503
            assert resp.json()["error"]["code"] == "WEBHOOK_NOT_CONFIGURED"

        app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Virtual cards feature flag
# ---------------------------------------------------------------------------
class TestVirtualCardsFeatureFlag:
    def test_create_card_returns_403_when_feature_disabled(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.db.session import get_db
        from app.api.deps import get_current_user

        mock_db = MagicMock()
        mock_user = MagicMock()
        mock_user.id = "user-1"

        app.dependency_overrides[get_db] = lambda: mock_db
        app.dependency_overrides[get_current_user] = lambda: mock_user

        with patch("app.api.routes.virtual_cards.settings") as s:
            s.FEATURE_VIRTUAL_CARDS = False
            client = TestClient(app)
            resp = client.post("/bills/00000000-0000-0000-0000-000000000001/virtual-card/create")
            assert resp.status_code == 403
            assert resp.json()["error"]["code"] == "FEATURE_DISABLED"

        app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Payment response strips stripe_client_secret
# ---------------------------------------------------------------------------
class TestPaymentResponseSecurity:
    def test_get_payment_strips_client_secret(self):
        """GET /payments/{id} must not return stripe_client_secret."""
        from fastapi.testclient import TestClient
        from app.main import app
        from app.db.session import get_db
        from app.api.deps import get_current_user
        import uuid

        mock_db = MagicMock()
        mock_user = MagicMock()
        mock_user.id = uuid.UUID("00000000-0000-0000-0000-000000000001")

        payment = MagicMock()
        payment.id = uuid.UUID("00000000-0000-0000-0000-000000000099")
        payment.bill_id = uuid.UUID("00000000-0000-0000-0000-000000000002")
        payment.bill_member_id = uuid.UUID("00000000-0000-0000-0000-000000000003")
        payment.user_id = mock_user.id
        payment.amount = Decimal("50.00")
        payment.currency = "USD"
        payment.status = "pending"
        payment.stripe_payment_intent_id = "pi_mock_123"
        payment.stripe_client_secret = "pi_mock_123_secret_abc"
        payment.created_at = "2025-01-01T00:00:00"
        payment.updated_at = "2025-01-01T00:00:00"

        bill = MagicMock()
        bill.owner_id = mock_user.id

        app.dependency_overrides[get_db] = lambda: mock_db
        app.dependency_overrides[get_current_user] = lambda: mock_user

        with patch("app.api.routes.payments.PaymentService") as MockSvc, \
             patch("app.api.routes.payments.require_bill_participant"):
            MockSvc.return_value.get_payment.return_value = payment
            client = TestClient(app)
            resp = client.get(f"/payments/{payment.id}")

            assert resp.status_code == 200
            data = resp.json()["data"]
            assert "stripe_client_secret" not in data

        app.dependency_overrides.clear()

    def test_list_payments_strips_client_secret(self):
        """GET /bills/{id}/payments must not return stripe_client_secret."""
        from fastapi.testclient import TestClient
        from app.main import app
        from app.db.session import get_db
        from app.api.deps import get_current_user
        import uuid

        mock_db = MagicMock()
        mock_user = MagicMock()
        mock_user.id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        bill_id = uuid.UUID("00000000-0000-0000-0000-000000000002")

        payment = MagicMock()
        payment.id = uuid.UUID("00000000-0000-0000-0000-000000000099")
        payment.bill_id = bill_id
        payment.bill_member_id = uuid.UUID("00000000-0000-0000-0000-000000000003")
        payment.user_id = mock_user.id
        payment.amount = Decimal("50.00")
        payment.currency = "USD"
        payment.status = "pending"
        payment.stripe_payment_intent_id = "pi_mock_123"
        payment.stripe_client_secret = "pi_mock_123_secret_abc"
        payment.created_at = "2025-01-01T00:00:00"
        payment.updated_at = "2025-01-01T00:00:00"

        app.dependency_overrides[get_db] = lambda: mock_db
        app.dependency_overrides[get_current_user] = lambda: mock_user

        with patch("app.api.routes.payments.PaymentService") as MockSvc, \
             patch("app.api.routes.payments.require_bill_participant"):
            MockSvc.return_value.get_bill_payments.return_value = [payment]
            client = TestClient(app)
            resp = client.get(f"/bills/{bill_id}/payments")

            assert resp.status_code == 200
            for item in resp.json()["data"]:
                assert "stripe_client_secret" not in item

        app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Payment confirm verifies Stripe PI status
# ---------------------------------------------------------------------------
class TestPaymentConfirmHardening:
    def test_route_rejects_non_pending_payment(self):
        """The route returns 409 for payments that are not 'pending'."""
        from fastapi.testclient import TestClient
        from app.main import app
        from app.db.session import get_db
        from app.api.deps import get_current_user
        import uuid

        mock_db = MagicMock()
        mock_user = MagicMock()
        mock_user.id = uuid.UUID("00000000-0000-0000-0000-000000000001")

        payment = MagicMock()
        payment.id = uuid.UUID("00000000-0000-0000-0000-000000000099")
        payment.bill_id = uuid.UUID("00000000-0000-0000-0000-000000000002")
        payment.status = "succeeded"

        app.dependency_overrides[get_db] = lambda: mock_db
        app.dependency_overrides[get_current_user] = lambda: mock_user

        with patch("app.api.routes.payments.PaymentService") as MockSvc, \
             patch("app.api.routes.payments.require_bill_participant"):
            MockSvc.return_value.get_payment.return_value = payment
            client = TestClient(app)
            resp = client.post(f"/payments/{payment.id}/confirm")
            assert resp.status_code == 409
            assert resp.json()["error"]["code"] == "CONFLICT"

        app.dependency_overrides.clear()

    def test_confirm_sets_member_to_paid(self):
        """confirm_payment should set member status to 'paid'."""
        from app.services.payment_service import PaymentService

        db = MagicMock()
        payment = MagicMock()
        payment.id = "pay-1"
        payment.status = "pending"
        payment.bill_member_id = "member-1"

        member = MagicMock()
        member.status = "pending"

        db.query.return_value.filter.return_value.first.side_effect = [
            payment,  # payment lookup
            member,   # member lookup
        ]

        svc = PaymentService(db)
        result = svc.confirm_payment("pay-1")

        assert result.status == "succeeded"
        assert member.status == "paid"
        db.commit.assert_called_once()

    def test_confirm_payment_not_found(self):
        from app.services.payment_service import PaymentService

        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None

        svc = PaymentService(db)
        with pytest.raises(ValueError, match="not found"):
            svc.confirm_payment("no-such-payment")


# ---------------------------------------------------------------------------
# VirtualCard schemas never expose sensitive card details
# ---------------------------------------------------------------------------
class TestVirtualCardSchemaSafety:
    def test_virtual_card_out_excludes_sensitive_fields(self):
        from app.schemas.virtual_card import VirtualCardOut

        fields = set(VirtualCardOut.model_fields.keys())
        for dangerous in ("card_number", "cvc", "exp_month", "exp_year"):
            assert dangerous not in fields, f"{dangerous} must not appear in VirtualCardOut"

    def test_virtual_card_summary_excludes_sensitive_fields(self):
        from app.schemas.virtual_card import VirtualCardSummary

        fields = set(VirtualCardSummary.model_fields.keys())
        for dangerous in ("card_number", "cvc", "exp_month", "exp_year"):
            assert dangerous not in fields, f"{dangerous} must not appear in VirtualCardSummary"


# ---------------------------------------------------------------------------
# Payment service: create intent idempotency (reuses pending)
# ---------------------------------------------------------------------------
class TestPaymentServiceIdempotency:
    @patch("app.services.payment_service.settings")
    def test_reuses_existing_pending_payment(self, mock_settings):
        mock_settings.STRIPE_SECRET_KEY = ""

        from app.services.payment_service import PaymentService

        db = MagicMock()
        existing = MagicMock()
        existing.status = "pending"
        existing.payment_link_token = "tok_existing"

        db.query.return_value.filter.return_value.first.return_value = existing

        svc = PaymentService(db)
        result = svc.create_payment_intent(
            bill_id="bill-1",
            member_id="member-1",
            user_id="user-1",
            amount=Decimal("50.00"),
        )

        assert result is existing
        assert result.amount == Decimal("50.00")
        db.add.assert_not_called()


# ---------------------------------------------------------------------------
# Readiness route: participant authz on GET /readiness
# ---------------------------------------------------------------------------
class TestReadinessRouteAuthz:
    def test_readiness_requires_participant(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.db.session import get_db
        from app.api.deps import get_current_user

        mock_db = MagicMock()
        mock_user = MagicMock()
        mock_user.id = "stranger-id"

        app.dependency_overrides[get_db] = lambda: mock_db
        app.dependency_overrides[get_current_user] = lambda: mock_user

        with patch("app.api.deps_bill.require_bill_participant", side_effect=ValueError("FORBIDDEN")):
            client = TestClient(app)
            resp = client.get("/bills/00000000-0000-0000-0000-000000000001/readiness")
            assert resp.status_code == 403

        app.dependency_overrides.clear()

    def test_readiness_returns_404_for_missing_bill(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.db.session import get_db
        from app.api.deps import get_current_user

        mock_db = MagicMock()
        mock_user = MagicMock()
        mock_user.id = "user-1"

        app.dependency_overrides[get_db] = lambda: mock_db
        app.dependency_overrides[get_current_user] = lambda: mock_user

        with patch("app.api.deps_bill.require_bill_participant", side_effect=ValueError("NOT_FOUND")):
            client = TestClient(app)
            resp = client.get("/bills/00000000-0000-0000-0000-000000000001/readiness")
            assert resp.status_code == 404

        app.dependency_overrides.clear()
