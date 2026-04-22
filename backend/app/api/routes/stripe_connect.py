"""HTTP routes for Stripe Connect: onboard hosts, check status, instant
payouts to debit cards, list history, and receive Connect webhooks."""

import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.response import error_response, success_response
from app.db.session import get_db
from app.models.user import User
from app.schemas.payout import (
    BalanceOut,
    ConnectStatusOut,
    PayoutCreate,
    PayoutOut,
    PayoutsSetupRequest,
)
from app.services.stripe_connect_service import (
    StripeConnectError,
    StripeConnectService,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/stripe/connect", tags=["Stripe Connect"])


# Map service-level error codes → HTTP status. Keeping this in one place
# beats sprinkling try/except across every endpoint — each route just
# awaits the service call and lets `_to_error` handle the translation.
_STATUS_BY_CODE: dict[str, int] = {
    "STRIPE_NOT_CONFIGURED": 503,
    "NOT_CONNECTED": 409,
    "HOST_NOT_ONBOARDED": 409,
    "PAYOUTS_TEMPORARILY_DISABLED": 409,
    "EXTERNAL_ACCOUNT_NOT_INSTANT_CAPABLE": 409,
    "INSUFFICIENT_INSTANT_BALANCE": 409,
    "INVALID_AMOUNT": 400,
    "AMOUNT_TOO_SMALL": 400,
    "PAYOUT_INVALID": 400,
    "IDENTITY_REJECTED": 400,
    "CARD_DECLINED": 402,
    "INVALID_CARD": 400,
    "STRIPE_ERROR": 502,
    "WEBHOOK_NOT_CONFIGURED": 503,
    "INVALID_SIGNATURE": 400,
}


def _to_error(exc: StripeConnectError):
    return error_response(
        exc.code, exc.message, _STATUS_BY_CODE.get(exc.code, 400)
    )


# ─── Onboarding ──────────────────────────────────────────────────────────


@router.post("/setup", status_code=201)
def submit_payout_setup(
    body: PayoutsSetupRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Submit the in-app KYC form + tokenized debit card in one call.

    This is the Custom-account replacement for the old `/onboard`
    redirect flow. The mobile app:
      1. Shows identity fields + `CardField` from @stripe/stripe-react-native.
      2. Calls `createToken({ type: 'Card', currency: 'usd', ... })` → `tok_...`.
      3. POSTs everything here.
    """
    # Grab the client IP from the request — Stripe requires it on the
    # `tos_acceptance` block for Custom accounts. Use X-Forwarded-For
    # (set by the load balancer) if present, otherwise the direct peer.
    forwarded = request.headers.get("x-forwarded-for", "")
    client_ip = (
        forwarded.split(",")[0].strip()
        if forwarded
        else (request.client.host if request.client else "0.0.0.0")
    )

    try:
        svc = StripeConnectService(db)
        status_obj = svc.submit_payout_setup(
            current_user,
            individual=body.individual.model_dump(),
            card_token=body.card_token,
            client_ip=client_ip,
            payment_method_id=body.payment_method_id,
        )
    except StripeConnectError as e:
        return _to_error(e)

    return success_response(
        data=ConnectStatusOut(**status_obj.__dict__).model_dump(),
        message="Payouts setup complete",
    )


@router.get("/status")
def get_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        svc = StripeConnectService(db)
        status_obj = svc.refresh_account_status(current_user)
    except StripeConnectError as e:
        return _to_error(e)
    return success_response(
        data=ConnectStatusOut(**status_obj.__dict__).model_dump()
    )


@router.get("/balance")
def get_balance(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        svc = StripeConnectService(db)
        cents = svc.get_instant_available_cents(current_user)
    except StripeConnectError as e:
        return _to_error(e)
    return success_response(
        data=BalanceOut(instant_available_cents=cents, currency="usd").model_dump()
    )


# ─── Payouts ─────────────────────────────────────────────────────────────


@router.post("/payouts", status_code=201)
def create_instant_payout(
    body: PayoutCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        svc = StripeConnectService(db)
        payout = svc.create_instant_payout(
            current_user,
            amount_cents=body.amount_cents,
            currency=body.currency.lower(),
        )
    except StripeConnectError as e:
        return _to_error(e)
    return success_response(
        data=PayoutOut.model_validate(payout).model_dump(),
        message="Instant payout created",
    )


@router.get("/payouts")
def list_payouts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = StripeConnectService(db)
    payouts = svc.list_payouts(current_user)
    return success_response(
        data=[PayoutOut.model_validate(p).model_dump() for p in payouts]
    )


# ─── Webhook ─────────────────────────────────────────────────────────────


@router.post("/webhook")
async def connect_webhook(
    request: Request,
    db: Session = Depends(get_db),
):
    """Receive Connect-scoped events (separate webhook endpoint from
    /webhooks/stripe — Stripe signs each endpoint with its own secret)."""
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        svc = StripeConnectService(db)
        svc.handle_connect_webhook(payload, sig)
    except StripeConnectError as e:
        return _to_error(e)
    return success_response(message="Webhook processed")


# ─── Browser redirect landing pages ──────────────────────────────────────
#
# Stripe redirects the host's browser here after onboarding completes (or
# the link expires). `expo-web-browser` in the mobile app detects the
# redirect to these URLs and automatically closes, popping the host back
# into the app. The HTML body is only visible for a split second.


@router.get("/return", include_in_schema=False)
def connect_return():
    return HTMLResponse(
        "<html><body style='font-family:system-ui;text-align:center;"
        "margin-top:40vh;color:#006c5c;'>"
        "<p style='font-size:18px;'>✓ You're all set.</p>"
        "<p style='color:#666;'>Returning to the app…</p>"
        "</body></html>"
    )


@router.get("/refresh", include_in_schema=False)
def connect_refresh():
    return HTMLResponse(
        "<html><body style='font-family:system-ui;text-align:center;"
        "margin-top:40vh;color:#666;'>"
        "<p style='font-size:18px;'>Onboarding link expired.</p>"
        "<p>Returning to the app — tap Connect again to try.</p>"
        "</body></html>"
    )
