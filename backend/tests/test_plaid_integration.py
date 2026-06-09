"""Plaid + guest ACH integration tests (mocked external APIs)."""

from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

from app.services.payment_service import PaymentService
from app.services.plaid_service import PlaidError, PlaidService


class TestPlaidService:
    def test_disabled_raises(self):
        with patch("app.services.plaid_service.settings") as s:
            s.PLAID_ENABLED = False
            s.PLAID_CLIENT_ID = "id"
            s.PLAID_SECRET = "secret"
            with pytest.raises(PlaidError) as exc:
                PlaidService()
            assert exc.value.code == "PLAID_DISABLED"

    def test_complete_bank_link_orchestrates_exchange_and_btok(self):
        with patch("app.services.plaid_service.settings") as s:
            s.PLAID_ENABLED = True
            s.PLAID_CLIENT_ID = "id"
            s.PLAID_SECRET = "secret"
            s.PLAID_ENV = "sandbox"
            s.PLAID_PRODUCTS = ["auth"]
            s.PLAID_REDIRECT_URI = ""

            svc = PlaidService.__new__(PlaidService)
            svc._client = MagicMock()
            svc.exchange_public_token = MagicMock(return_value=("access", "item"))
            svc.create_stripe_bank_token = MagicMock(return_value="btok_test")
            btok = svc.complete_bank_link(
                public_token="public-sandbox", account_id="acc_1"
            )
            assert btok == "btok_test"
            svc.exchange_public_token.assert_called_once_with("public-sandbox")
            svc.create_stripe_bank_token.assert_called_once_with("access", "acc_1")


class TestPaymentWebhookProcessing:
    def test_processing_event_marks_payment(self):
        mock_db = MagicMock()
        payment = MagicMock()
        payment.id = "pay-1"
        payment.status = "pending"
        mock_db.query.return_value.filter.return_value.first.return_value = payment

        svc = PaymentService(mock_db)
        event = {
            "type": "payment_intent.processing",
            "data": {"object": {"id": "pi_ach_1"}},
        }

        with patch("app.services.payment_service.settings") as s, patch(
            "stripe.Webhook.construct_event", return_value=event
        ), patch("stripe.api_key", create=True):
            s.STRIPE_WEBHOOK_SECRET = "whsec_test"
            s.STRIPE_SECRET_KEY = "sk_test"
            svc.handle_stripe_webhook(b"{}", "sig")

        assert payment.status == "processing"
        mock_db.commit.assert_called()


class TestStripeIntentPaymentMethodTypes:
    def test_bank_intent_includes_us_bank_account(self):
        with patch("app.services.payment_service.settings") as s, patch(
            "stripe.PaymentIntent.create"
        ) as create_pi:
            s.STRIPE_SECRET_KEY = "sk_test"
            create_pi.return_value = MagicMock(id="pi_1", client_secret="sec")

            from app.services.payment_service import _stripe_intent_for_payment

            _stripe_intent_for_payment(
                "bill",
                "member",
                Decimal("12.50"),
                "USD",
                payment_method_types=["us_bank_account"],
            )

            kwargs = create_pi.call_args.kwargs
            assert kwargs["payment_method_types"] == ["us_bank_account"]
            assert kwargs["amount"] == 1250
