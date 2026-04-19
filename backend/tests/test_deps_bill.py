"""Unit tests for bill authorization helpers (deps_bill)."""

from unittest.mock import MagicMock

import pytest

from app.api.deps_bill import require_bill_owner, require_bill_participant


def _mock_bill(owner_id="owner-1"):
    bill = MagicMock()
    bill.id = "bill-1"
    bill.owner_id = owner_id
    return bill


def _mock_member(bill_id="bill-1", user_id="member-1"):
    m = MagicMock()
    m.bill_id = bill_id
    m.user_id = user_id
    return m


class TestRequireBillOwner:
    def test_owner_succeeds(self):
        db = MagicMock()
        bill = _mock_bill(owner_id="owner-1")
        db.query.return_value.filter.return_value.first.return_value = bill

        result = require_bill_owner(db, "bill-1", "owner-1")
        assert result is bill

    def test_not_found_raises(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None

        with pytest.raises(ValueError, match="NOT_FOUND"):
            require_bill_owner(db, "no-bill", "owner-1")

    def test_non_owner_raises_forbidden(self):
        db = MagicMock()
        bill = _mock_bill(owner_id="owner-1")
        db.query.return_value.filter.return_value.first.return_value = bill

        with pytest.raises(ValueError, match="FORBIDDEN"):
            require_bill_owner(db, "bill-1", "someone-else")


class TestRequireBillParticipant:
    def test_owner_passes(self):
        db = MagicMock()
        bill = _mock_bill(owner_id="owner-1")
        db.query.return_value.filter.return_value.first.return_value = bill

        result = require_bill_participant(db, "bill-1", "owner-1")
        assert result is bill

    def test_member_passes(self):
        db = MagicMock()
        bill = _mock_bill(owner_id="owner-1")
        member = _mock_member()

        db.query.return_value.filter.return_value.first.side_effect = [
            bill,    # bill lookup
            member,  # member lookup
        ]

        result = require_bill_participant(db, "bill-1", "member-1")
        assert result is bill

    def test_not_found_raises(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None

        with pytest.raises(ValueError, match="NOT_FOUND"):
            require_bill_participant(db, "no-bill", "anyone")

    def test_non_participant_raises_forbidden(self):
        db = MagicMock()
        bill = _mock_bill(owner_id="owner-1")

        db.query.return_value.filter.return_value.first.side_effect = [
            bill,  # bill lookup
            None,  # member lookup returns None
        ]

        with pytest.raises(ValueError, match="FORBIDDEN"):
            require_bill_participant(db, "bill-1", "stranger")
