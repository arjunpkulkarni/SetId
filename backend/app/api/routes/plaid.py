"""Plaid Link routes — bank auth → Stripe ``btok_`` for payouts and guest ACH."""

import logging

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_optional_current_user
from app.utils.timing import Timer
from app.core.config import settings
from app.core.response import error_response, success_response
from app.db.session import get_db
from app.models.user import User
from app.schemas.plaid import (
    PlaidCompleteGuestPayRequest,
    PlaidCompletePayoutRequest,
    PlaidGuestPayCompleteResponse,
    PlaidLinkTokenRequest,
    PlaidLinkTokenResponse,
    PlaidPayoutCompleteResponse,
)
from app.services.payment_service import PaymentService
from app.services.plaid_service import PlaidError, PlaidService
from app.services.stripe_connect_service import (
    StripeConnectError,
    StripeConnectService,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/plaid", tags=["Plaid"])


_STATUS_BY_PLAID: dict[str, int] = {
    "PLAID_DISABLED": 503,
    "PLAID_NOT_CONFIGURED": 503,
    "PLAID_LINK_TOKEN_FAILED": 502,
    "PLAID_EXCHANGE_FAILED": 400,
    "PLAID_STRIPE_TOKEN_FAILED": 400,
    "NOT_FOUND": 404,
    "PAYMENTS_LOCKED": 403,
    "TOKEN_EXPIRED": 410,
}

_STATUS_BY_CONNECT: dict[str, int] = {
    "STRIPE_NOT_CONFIGURED": 503,
    "INVALID_BANK_ACCOUNT": 400,
    "NOT_CONNECTED": 409,
    "STRIPE_ERROR": 502,
}


def _plaid_error(exc: PlaidError):
    return error_response(
        exc.code, exc.message, _STATUS_BY_PLAID.get(exc.code, 400)
    )


def _connect_error(exc: StripeConnectError):
    return error_response(
        exc.code, exc.message, _STATUS_BY_CONNECT.get(exc.code, 400)
    )


def _client_meta(request: Request) -> tuple[str, str]:
    forwarded = request.headers.get("x-forwarded-for", "")
    client_ip = (
        forwarded.split(",")[0].strip()
        if forwarded
        else (request.client.host if request.client else "0.0.0.0")
    )
    user_agent = request.headers.get("user-agent") or "settld-client"
    return client_ip, user_agent


@router.post("/link-token")
def create_link_token(
    body: PlaidLinkTokenRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    if not settings.PLAID_ENABLED:
        return error_response(
            "PLAID_DISABLED",
            "Bank linking is not enabled.",
            503,
        )

    try:
        plaid_svc = PlaidService()
    except PlaidError as e:
        return _plaid_error(e)

    if body.purpose == "payout":
        if current_user is None:
            return error_response("UNAUTHORIZED", "Sign in to link a bank account.", 401)
        client_user_id = str(current_user.id)
        redirect_uri = None
    else:
        pay_svc = PaymentService(db)
        payment = None
        if body.payment_id:
            payment = pay_svc.get_payment(str(body.payment_id))
        elif body.pay_token:
            payment = pay_svc.get_payment_by_link_token(body.pay_token)
        if not payment:
            return error_response(
                "NOT_FOUND", "Payment not found for bank linking.", 404
            )
        from app.api.routes.pay_public import _token_expired
        from app.services.guest_pay_gate import bill_allows_guest_payment

        if payment.status == "pending" and _token_expired(payment):
            return error_response(
                "TOKEN_EXPIRED",
                "This payment link has expired.",
                410,
            )
        if payment.status != "pending":
            return error_response(
                "PAYMENT_NOT_PENDING",
                "This payment is no longer open.",
                409,
            )
        if not bill_allows_guest_payment(payment.bill):
            return error_response(
                "PAYMENTS_LOCKED",
                "The host has not opened payments yet.",
                403,
            )
        client_user_id = str(payment.bill_member_id)
        redirect_uri = (settings.PLAID_REDIRECT_URI or "").strip() or None

    try:
        token_data = plaid_svc.create_link_token(
            client_user_id=client_user_id,
            purpose=body.purpose,
            redirect_uri=redirect_uri,
        )
    except PlaidError as e:
        return _plaid_error(e)

    return success_response(
        data=PlaidLinkTokenResponse(**token_data).model_dump(),
        message="Plaid link token created",
    )


@router.post("/complete-payout")
def complete_payout(
    body: PlaidCompletePayoutRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        with Timer("plaid.complete_payout", user_id=str(current_user.id)):
            plaid_svc = PlaidService()
            btok = plaid_svc.complete_bank_link(
                public_token=body.public_token,
                account_id=body.account_id,
            )
            connect_svc = StripeConnectService(db)
            status = connect_svc.attach_bank_token_from_plaid(current_user, btok)
    except PlaidError as e:
        return _plaid_error(e)
    except StripeConnectError as e:
        return _connect_error(e)

    return success_response(
        data=PlaidPayoutCompleteResponse(
            connected=status.connected,
            payouts_enabled=status.payouts_enabled,
            external_account_last4=status.external_account_last4,
            external_account_type=status.external_account_type,
        ).model_dump(),
        message="Bank account linked for payouts",
    )


@router.post("/complete-guest-pay")
def complete_guest_pay(
    body: PlaidCompleteGuestPayRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    pay_svc = PaymentService(db)
    payment = None
    if body.payment_id:
        payment = pay_svc.get_payment(str(body.payment_id))
    elif body.pay_token:
        payment = pay_svc.get_payment_by_link_token(body.pay_token)
    if not payment:
        return error_response("NOT_FOUND", "Payment not found.", 404)

    from app.api.routes.pay_public import _token_expired
    from app.services.guest_pay_gate import bill_allows_guest_payment

    if payment.status == "pending" and _token_expired(payment):
        return error_response(
            "TOKEN_EXPIRED", "This payment link has expired.", 410
        )
    if payment.status != "pending":
        return error_response(
            "PAYMENT_NOT_PENDING", "This payment is already completed.", 409
        )
    if not bill_allows_guest_payment(payment.bill):
        return error_response(
            "PAYMENTS_LOCKED", "Payments are not open for this bill.", 403
        )

    client_ip, user_agent = _client_meta(request)

    try:
        with Timer("plaid.complete_guest_pay", payment_id=str(payment.id)):
            plaid_svc = PlaidService()
            btok = plaid_svc.complete_bank_link(
                public_token=body.public_token,
                account_id=body.account_id,
            )
            result = pay_svc.complete_guest_pay_with_bank_token(
                payment,
                btok,
                client_ip=client_ip,
                user_agent=user_agent,
            )
    except PlaidError as e:
        return _plaid_error(e)
    except ValueError as e:
        msg = str(e)
        code = "GUEST_PAY_FAILED"
        if "NOT_FOUND" in msg:
            code = "NOT_FOUND"
        return error_response(code, msg, 400)

    bank_last4 = None
    try:
        import stripe

        stripe.api_key = settings.STRIPE_SECRET_KEY
        tok = stripe.Token.retrieve(btok)
        ba = getattr(tok, "bank_account", None)
        if ba is not None:
            bank_last4 = getattr(ba, "last4", None)
    except Exception:
        pass

    return success_response(
        data=PlaidGuestPayCompleteResponse(
            payment_id=str(result.id),
            status=result.status,
            stripe_payment_intent_id=result.stripe_payment_intent_id,
            bank_last4=bank_last4,
        ).model_dump(),
        message=(
            "Payment processing"
            if result.status == "processing"
            else "Payment submitted"
        ),
    )
