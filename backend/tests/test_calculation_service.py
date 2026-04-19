"""Unit tests for CalculationService split logic."""

from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

from app.services.calculation_service import CalculationService


def _mock_item(total_price: str):
    item = MagicMock()
    item.total_price = Decimal(total_price)
    return item


class TestCalculateAmountOwed:
    def setup_method(self):
        self.db = MagicMock()
        self.svc = CalculationService(self.db)

    def test_equal_split_two_people(self):
        item = _mock_item("20.00")
        result = self.svc._calculate_amount_owed("equal", Decimal("0"), item, 2)
        assert result == Decimal("10.00")

    def test_equal_split_three_people_rounds(self):
        item = _mock_item("10.00")
        result = self.svc._calculate_amount_owed("equal", Decimal("0"), item, 3)
        assert result == Decimal("3.33")

    def test_equal_split_zero_count(self):
        item = _mock_item("10.00")
        result = self.svc._calculate_amount_owed("equal", Decimal("0"), item, 0)
        assert result == Decimal("0")

    def test_percentage(self):
        item = _mock_item("100.00")
        result = self.svc._calculate_amount_owed("percentage", Decimal("25"), item, 1)
        assert result == Decimal("25.00")

    def test_fixed(self):
        item = _mock_item("100.00")
        result = self.svc._calculate_amount_owed("fixed", Decimal("42.50"), item, 1)
        assert result == Decimal("42.50")

    def test_unknown_share_type_raises(self):
        item = _mock_item("10.00")
        with pytest.raises(ValueError, match="Unknown share_type"):
            self.svc._calculate_amount_owed("bogus", Decimal("0"), item, 1)

    def test_single_owner_item(self):
        """Single owner = one assignment, equal split with count=1 => full price."""
        item = _mock_item("55.99")
        result = self.svc._calculate_amount_owed("equal", Decimal("0"), item, 1)
        assert result == Decimal("55.99")

    def test_proportional_tax_share(self):
        """Simulate proportional tax allocation manually."""
        bill_subtotal = Decimal("100.00")
        bill_tax = Decimal("8.50")
        member_subtotal = Decimal("30.00")

        proportion = member_subtotal / bill_subtotal
        tax_share = (proportion * bill_tax).quantize(Decimal("0.01"))
        assert tax_share == Decimal("2.55")

    def test_optional_tip_zero(self):
        """When tip is zero, tip share should be zero regardless of proportion."""
        bill_tip = Decimal("0.00")
        proportion = Decimal("0.40")
        tip_share = (proportion * bill_tip).quantize(Decimal("0.01"))
        assert tip_share == Decimal("0.00")

    def test_optional_tip_nonzero(self):
        bill_tip = Decimal("15.00")
        proportion = Decimal("0.40")
        tip_share = (proportion * bill_tip).quantize(Decimal("0.01"))
        assert tip_share == Decimal("6.00")


class TestRecalculateMixedShareTypes:
    """Verify recalculate handles mixed equal + fixed + percentage on one item."""

    def setup_method(self):
        self.db = MagicMock()
        self.svc = CalculationService(self.db)

    def _make_assignment(self, share_type, share_value):
        a = MagicMock()
        a.share_type = share_type
        a.share_value = Decimal(str(share_value))
        a.amount_owed = Decimal("0")
        return a

    def test_mixed_fixed_and_equal(self):
        item = _mock_item("100.00")
        item.id = "item-1"

        a_fixed = self._make_assignment("fixed", "30.00")
        a_equal_1 = self._make_assignment("equal", "0")
        a_equal_2 = self._make_assignment("equal", "0")

        bill = MagicMock()
        bill.subtotal = Decimal("100.00")
        bill.tax = Decimal("0")
        bill.tip = Decimal("0")
        bill.service_fee = Decimal("0")

        self.db.query.return_value.filter.return_value.all.side_effect = [
            [item],
            [a_fixed, a_equal_1, a_equal_2],
        ]
        self.db.query.return_value.filter.return_value.first.return_value = bill

        self.svc.recalculate("bill-1")

        assert a_fixed.amount_owed == Decimal("30.00")
        assert a_equal_1.amount_owed == Decimal("35.00")
        assert a_equal_2.amount_owed == Decimal("35.00")

    def test_mixed_percentage_and_equal(self):
        item = _mock_item("200.00")
        item.id = "item-1"

        a_pct = self._make_assignment("percentage", "25")
        a_equal = self._make_assignment("equal", "0")

        bill = MagicMock()
        bill.subtotal = Decimal("200.00")
        bill.tax = Decimal("0")
        bill.tip = Decimal("0")
        bill.service_fee = Decimal("0")

        self.db.query.return_value.filter.return_value.all.side_effect = [
            [item],
            [a_pct, a_equal],
        ]
        self.db.query.return_value.filter.return_value.first.return_value = bill

        self.svc.recalculate("bill-1")

        assert a_pct.amount_owed == Decimal("50.00")
        assert a_equal.amount_owed == Decimal("150.00")
