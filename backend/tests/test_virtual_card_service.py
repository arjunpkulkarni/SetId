"""Unit tests for VirtualCardService."""

from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

from app.services.virtual_card_service import VirtualCardService


def _mock_bill(total="100.00", owner_id="owner-1", currency="USD", ready=True):
    bill = MagicMock()
    bill.id = "bill-1"
    bill.total = Decimal(total)
    bill.owner_id = owner_id
    bill.currency = currency
    bill.ready_to_pay = ready
    bill.title = "Test Dinner"
    return bill


class TestCreateCardForBill:
    @patch("app.services.virtual_card_service.settings")
    def test_mock_card_created_when_ready(self, mock_settings):
        mock_settings.STRIPE_ISSUING_ENABLED = False
        mock_settings.STRIPE_SECRET_KEY = ""

        db = MagicMock()
        bill = _mock_bill(ready=True)
        db.query.return_value.filter.return_value.first.side_effect = [
            bill,   # bill lookup in create_card_for_bill
            None,   # idempotency check (no existing card)
        ]

        evaluation = {
            "ready_to_pay": True,
            "meets_threshold": True,
            "total_collected": Decimal("100.00"),
            "bill_total": Decimal("100.00"),
        }

        with patch(
            "app.services.virtual_card_service.ReadinessService"
        ) as MockReadiness:
            MockReadiness.return_value.evaluate.return_value = evaluation

            svc = VirtualCardService(db)
            card = svc.create_card_for_bill("bill-1", "owner-1")

        assert card is not None
        db.add.assert_called_once()
        db.commit.assert_called_once()

    @patch("app.services.virtual_card_service.settings")
    def test_not_ready_rejects(self, mock_settings):
        mock_settings.STRIPE_ISSUING_ENABLED = False

        db = MagicMock()
        bill = _mock_bill(ready=False)
        db.query.return_value.filter.return_value.first.return_value = bill

        evaluation = {
            "ready_to_pay": False,
            "meets_threshold": False,
        }

        with patch(
            "app.services.virtual_card_service.ReadinessService"
        ) as MockReadiness:
            MockReadiness.return_value.evaluate.return_value = evaluation

            svc = VirtualCardService(db)
            with pytest.raises(ValueError, match="NOT_READY"):
                svc.create_card_for_bill("bill-1", "owner-1")

    @patch("app.services.virtual_card_service.settings")
    def test_non_owner_forbidden(self, mock_settings):
        mock_settings.STRIPE_ISSUING_ENABLED = False

        db = MagicMock()
        bill = _mock_bill(owner_id="real-owner")
        db.query.return_value.filter.return_value.first.return_value = bill

        svc = VirtualCardService(db)
        with pytest.raises(ValueError, match="FORBIDDEN"):
            svc.create_card_for_bill("bill-1", "not-owner")

    @patch("app.services.virtual_card_service.settings")
    def test_idempotency_returns_existing(self, mock_settings):
        mock_settings.STRIPE_ISSUING_ENABLED = False

        db = MagicMock()
        bill = _mock_bill(ready=True)
        existing_card = MagicMock()
        existing_card.id = "existing-card-id"

        db.query.return_value.filter.return_value.first.side_effect = [
            bill,           # bill lookup
            existing_card,  # idempotency check finds existing
        ]

        evaluation = {"ready_to_pay": True, "meets_threshold": True}

        with patch(
            "app.services.virtual_card_service.ReadinessService"
        ) as MockReadiness:
            MockReadiness.return_value.evaluate.return_value = evaluation

            svc = VirtualCardService(db)
            result = svc.create_card_for_bill("bill-1", "owner-1")

        assert result is existing_card
        db.add.assert_not_called()


class TestGetCardForBill:
    def test_returns_active_card(self):
        db = MagicMock()
        card = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = card

        svc = VirtualCardService(db)
        result = svc.get_card_for_bill("bill-1")

        assert result is card

    def test_returns_none_when_no_card(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None

        svc = VirtualCardService(db)
        result = svc.get_card_for_bill("bill-1")

        assert result is None


class TestDeactivateCard:
    @patch("app.services.virtual_card_service.settings")
    def test_deactivate_mock_card(self, mock_settings):
        mock_settings.STRIPE_ISSUING_ENABLED = False

        db = MagicMock()
        card = MagicMock()
        card.id = "card-1"
        card.bill_id = "bill-1"
        card.stripe_card_id = "ic_mock_abc123"
        card.status = "active"
        card.is_active = True

        bill = _mock_bill(owner_id="owner-1")

        db.query.return_value.filter.return_value.first.side_effect = [
            card,  # card lookup
            bill,  # bill lookup
        ]

        svc = VirtualCardService(db)
        result = svc.deactivate_card("card-1", "owner-1")

        assert result.status == "canceled"
        assert result.is_active is False
        db.commit.assert_called_once()

    @patch("app.services.virtual_card_service.settings")
    def test_deactivate_not_found(self, mock_settings):
        mock_settings.STRIPE_ISSUING_ENABLED = False

        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None

        svc = VirtualCardService(db)
        with pytest.raises(ValueError, match="NOT_FOUND"):
            svc.deactivate_card("no-card", "owner-1")

    @patch("app.services.virtual_card_service.settings")
    def test_deactivate_non_owner_forbidden(self, mock_settings):
        mock_settings.STRIPE_ISSUING_ENABLED = False

        db = MagicMock()
        card = MagicMock()
        card.id = "card-1"
        card.bill_id = "bill-1"

        bill = _mock_bill(owner_id="real-owner")

        db.query.return_value.filter.return_value.first.side_effect = [
            card,  # card lookup
            bill,  # bill lookup
        ]

        svc = VirtualCardService(db)
        with pytest.raises(ValueError, match="FORBIDDEN"):
            svc.deactivate_card("card-1", "not-owner")

    @patch("app.services.virtual_card_service.settings")
    def test_deactivate_bill_not_found_forbidden(self, mock_settings):
        mock_settings.STRIPE_ISSUING_ENABLED = False

        db = MagicMock()
        card = MagicMock()
        card.id = "card-1"
        card.bill_id = "bill-1"

        db.query.return_value.filter.return_value.first.side_effect = [
            card,  # card lookup
            None,  # bill lookup returns None
        ]

        svc = VirtualCardService(db)
        with pytest.raises(ValueError, match="FORBIDDEN"):
            svc.deactivate_card("card-1", "owner-1")


class TestIdempotencyKey:
    def test_deterministic_for_same_bill(self):
        k1 = VirtualCardService._idempotency_key("bill-123")
        k2 = VirtualCardService._idempotency_key("bill-123")
        assert k1 == k2

    def test_different_for_different_bills(self):
        k1 = VirtualCardService._idempotency_key("bill-1")
        k2 = VirtualCardService._idempotency_key("bill-2")
        assert k1 != k2
