"""Public payment link resolution (no auth). Token is opaque; never expose internal UUIDs in URLs."""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.response import error_response, success_response
from app.db.session import get_db
from app.services.payment_service import PaymentService
from app.services.calculation_service import CalculationService
from app.models.item_assignment import ItemAssignment
from app.models.receipt_item import ReceiptItem

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Public payments"])


@router.get("/pay/{token}/page", include_in_schema=False)
def serve_payment_page(token: str):
    """Serve the web payment page HTML for browser users."""
    return FileResponse("static/pay.html")
def _token_expired(payment) -> bool:
    """Return True if the pay-link token has exceeded PAY_LINK_TTL_MINUTES."""
    ttl = settings.PAY_LINK_TTL_MINUTES
    if ttl <= 0:
        return False
    created = payment.created_at
    if created is None:
        return False
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    age_seconds = (datetime.now(timezone.utc) - created).total_seconds()
    return age_seconds > ttl * 60


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

    if payment.status == "pending" and _token_expired(payment):
        logger.info("pay_link_expired", extra={"payment_id": str(payment.id)})
        return error_response(
            "TOKEN_EXPIRED",
            "This payment link has expired. Please request a new one.",
            410,
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
    except ValueError as e:
        error_msg = str(e)
        if "NOT_FOUND" in error_msg:
            return error_response("NOT_FOUND", "Payment not found", 404)
        # Return specific error message from payment service
        logger.error(
            "Payment setup validation failed",
            extra={"payment_id": str(payment.id), "error": error_msg}
        )
        return error_response(
            "PAYMENT_SETUP_ERROR",
            error_msg,
            400
        )
    except Exception as e:
        logger.exception("Stripe attach failed for public pay")
        error_msg = str(e)
        # Provide more specific error messages
        if "api_key" in error_msg.lower():
            error_msg = "Payment service configuration error. Please contact support."
        elif "amount" in error_msg.lower():
            error_msg = "Invalid payment amount. Please contact the bill owner."
        else:
            error_msg = f"Payment setup failed: {error_msg}"
        
        return error_response("PAYMENT_SETUP_ERROR", error_msg, 502)

    db.refresh(payment)
    bill = payment.bill
    member = payment.member
    base = settings.PUBLIC_PAYMENT_BASE_URL.rstrip("/")
    deep_link = f"wealthsplit://pay?token={token}"

    # Get member's assigned items
    assignments = (
        db.query(ItemAssignment)
        .join(ReceiptItem, ItemAssignment.receipt_item_id == ReceiptItem.id)
        .filter(ItemAssignment.bill_member_id == payment.bill_member_id)
        .all()
    )

    items = []
    for assignment in assignments:
        item = assignment.item
        items.append({
            "name": item.name,
            "quantity": item.quantity,
            "unit_price": str(item.unit_price),
            "total_price": str(item.total_price),
            "assigned_amount": str(assignment.amount_owed),
            "share_type": assignment.share_type,
        })

    # Get payment breakdown for this member
    calc_svc = CalculationService(db)
    breakdown_data = calc_svc.get_balance_breakdown(str(bill.id))
    
    member_breakdown = None
    for m in breakdown_data["members"]:
        if m["member_id"] == str(member.id):
            member_breakdown = {
                "subtotal": str(m["subtotal"]),
                "tax_share": str(m["tax_share"]),
                "tip_share": str(m["tip_share"]),
                "fee_share": str(m["fee_share"]),
                "total_owed": str(m["total_owed"]),
            }
            break

    # Add service fee info
    service_fee_info = {
        "type": bill.service_fee_type or settings.SERVICE_FEE_TYPE,
        "amount": str(bill.service_fee),
        "percentage": str(bill.service_fee_percentage) if bill.service_fee_percentage else None,
    }

    return success_response(
        data={
            "status": "pending",
            "payment_id": str(payment.id),
            "amount": str(payment.amount),
            "currency": payment.currency,
            "bill_title": bill.title if bill else None,
            "bill_id": str(bill.id),
            "merchant_name": bill.merchant_name,
            "member_nickname": member.nickname if member else None,
            "stripe_client_secret": payment.stripe_client_secret,
            "stripe_publishable_key": settings.STRIPE_PUBLISHABLE_KEY,
            "items": items,
            "breakdown": member_breakdown,
            "service_fee": service_fee_info,
            "pay_url": f"{base}/pay/{token}",
            "deep_link": deep_link,
        }
    )
