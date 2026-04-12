"""Public payment link resolution (no auth). Token is opaque; never expose internal UUIDs in URLs."""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.response import error_response, success_response
from app.db.session import get_db
from app.services.payment_service import PaymentService

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Public payments"])


@router.get("/pay/{token}")
def get_public_payment(token: str, db: Session = Depends(get_db)):
    """
    Resolve a pay link. Returns JSON for app/web clients to complete checkout.
    """
    svc = PaymentService(db)
    payment = svc.get_payment_by_link_token(token)
    if not payment:
        return error_response(
            "NOT_FOUND",
            "Invalid or expired payment link.",
            404,
        )

    bill = payment.bill
    if payment.status != "pending":
        msg = (
            "This payment is already completed."
            if payment.status == "succeeded"
            else "This payment is no longer available."
        )
        return success_response(
            data={
                "status": payment.status,
                "message": msg,
                "bill_title": bill.title if bill else None,
                "amount": str(payment.amount),
                "currency": payment.currency,
            }
        )

    try:
        svc.ensure_stripe_client_for_payment(str(payment.id))
    except ValueError:
        return error_response("NOT_FOUND", "Payment not found", 404)
    except Exception as e:
        logger.exception("Stripe attach failed for public pay")
        return error_response("PAYMENT_SETUP_ERROR", str(e), 502)

    db.refresh(payment)
    bill = payment.bill
    base = settings.PUBLIC_PAYMENT_BASE_URL.rstrip("/")
    deep_link = f"wealthsplit://pay?token={token}"

    return success_response(
        data={
            "status": "pending",
            "payment_id": str(payment.id),
            "amount": str(payment.amount),
            "currency": payment.currency,
            "bill_title": bill.title if bill else None,
            "stripe_client_secret": payment.stripe_client_secret,
            "pay_url": f"{base}/pay/{token}",
            "deep_link": deep_link,
        }
    )
