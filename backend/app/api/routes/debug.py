"""Debug endpoints for troubleshooting payment issues (disable in production)."""

import logging
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.response import success_response, error_response
from app.db.session import get_db
from app.models.bill import Bill
from app.models.bill_member import BillMember
from app.models.payment import Payment
from app.models.user import User
from app.services.calculation_service import CalculationService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/debug", tags=["Debug"])


@router.get("/bill/{bill_id}/payment-status")
def debug_bill_payment_status(
    bill_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Debug endpoint to see payment calculation details for a bill.
    Shows why payments might be failing.
    """
    
    # Check if bill exists
    bill = db.query(Bill).filter(Bill.id == bill_id).first()
    if not bill:
        return error_response("NOT_FOUND", "Bill not found", 404)
    
    # Check if user is a participant
    member = (
        db.query(BillMember)
        .filter(
            BillMember.bill_id == bill_id,
            BillMember.user_id == current_user.id
        )
        .first()
    )
    
    if not member and str(bill.owner_id) != str(current_user.id):
        return error_response("FORBIDDEN", "Not authorized", 403)
    
    # Get balance breakdown
    calc_svc = CalculationService(db)
    try:
        breakdown = calc_svc.get_balance_breakdown(bill_id)
    except Exception as e:
        return error_response("CALCULATION_ERROR", f"Failed to calculate: {str(e)}", 500)
    
    # Get all payments
    payments = db.query(Payment).filter(Payment.bill_id == bill_id).all()
    
    payment_details = []
    for p in payments:
        payment_details.append({
            "id": str(p.id),
            "member_id": str(p.bill_member_id),
            "user_id": str(p.user_id) if p.user_id else None,
            "amount": str(p.amount),
            "currency": p.currency,
            "status": p.status,
            "has_stripe_intent": bool(p.stripe_payment_intent_id),
            "has_client_secret": bool(p.stripe_client_secret),
            "has_payment_link": bool(p.payment_link_token),
            "created_at": p.created_at.isoformat() if p.created_at else None,
        })
    
    # Check for potential issues
    issues = []
    
    for m in breakdown["members"]:
        member_id = m["member_id"]
        remaining = Decimal(str(m["remaining"]))
        
        if not m.get("is_host") and remaining > 0:
            # Find if there's a payment for this member
            member_payments = [p for p in payments if str(p.bill_member_id) == member_id and p.status == "pending"]
            
            if not member_payments:
                issues.append(f"Member {m['nickname']} ({member_id}) owes ${remaining} but has no pending payment")
            else:
                for p in member_payments:
                    if p.amount <= 0:
                        issues.append(f"Member {m['nickname']} has payment with invalid amount: ${p.amount}")
                    
                    if p.amount < Decimal("0.50") and p.currency == "USD":
                        issues.append(
                            f"Member {m['nickname']} payment amount ${p.amount} is below Stripe minimum ($0.50 USD)"
                        )
    
    # Get member details
    members_info = []
    for m in breakdown["members"]:
        member_obj = db.query(BillMember).filter(BillMember.id == m["member_id"]).first()
        members_info.append({
            "id": m["member_id"],
            "nickname": m["nickname"],
            "is_host": m.get("is_host", False),
            "has_user": bool(member_obj.user_id) if member_obj else False,
            "status": member_obj.status if member_obj else None,
            "subtotal": str(m["subtotal"]),
            "tax_share": str(m["tax_share"]),
            "tip_share": str(m["tip_share"]),
            "fee_share": str(m["fee_share"]),
            "total_owed": str(m["total_owed"]),
            "total_paid": str(m["total_paid"]),
            "remaining": str(m["remaining"]),
        })
    
    return success_response(data={
        "bill": {
            "id": str(bill.id),
            "title": bill.title,
            "merchant_name": bill.merchant_name,
            "subtotal": str(bill.subtotal) if bill.subtotal else "0",
            "tax": str(bill.tax) if bill.tax else "0",
            "tip": str(bill.tip) if bill.tip else "0",
            "total": str(bill.total) if bill.total else "0",
            "currency": bill.currency or "USD",
            "service_fee": str(bill.service_fee) if bill.service_fee else "0",
        },
        "members": members_info,
        "payments": payment_details,
        "totals": {
            "total_paid": str(breakdown["total_paid"]),
            "total_remaining": str(breakdown["total_remaining"]),
        },
        "issues": issues,
        "stripe_config": {
            "has_secret_key": bool(settings.STRIPE_SECRET_KEY),
            "has_publishable_key": bool(settings.STRIPE_PUBLISHABLE_KEY),
            "using_live_keys": settings.STRIPE_SECRET_KEY.startswith("sk_live_") if settings.STRIPE_SECRET_KEY else False,
        }
    })
