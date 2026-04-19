"""Unit tests for payment link helpers and notification helpers."""

from decimal import Decimal
from unittest.mock import MagicMock, patch

from app.services.payment_notification_service import _money_str, _pay_url
from app.services.sms_service import send_sms


def test_pay_url_joins_base_and_token():
    with patch("app.services.payment_notification_service.settings") as s:
        s.PUBLIC_PAYMENT_BASE_URL = "https://app.wealthsplit.com/"
        assert _pay_url("tok_abc") == "https://app.wealthsplit.com/pay/tok_abc"


def test_money_str_usd():
    assert _money_str(Decimal("12.5"), "USD") == "$12.50"


@patch("app.services.sms_service.normalize_e164", return_value="+12025550123")
@patch("app.services.sms_service._twilio_ready", return_value=False)
def test_send_sms_dev_mode_logs(mock_ready, mock_e164):
    db = MagicMock()
    with patch("app.services.sms_service.settings") as s:
        s.SMS_DEV_MODE = True
        r = send_sms(
            db,
            to_phone="+12025550123",
            message="hello",
            user_id=None,
            payment_id=None,
            kind="payment_request",
        )
    assert r.ok is True
    assert r.status == "sent"


def test_send_sms_invalid_phone_skipped():
    db = MagicMock()
    r = send_sms(
        db,
        to_phone="not-a-phone",
        message="hello",
        user_id=None,
        payment_id=None,
        kind="reminder",
    )
    assert r.ok is False
    assert r.status == "skipped"
