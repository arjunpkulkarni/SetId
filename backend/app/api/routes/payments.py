import logging
import uuid

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.deps_bill import require_bill_participant
from app.core.config import settings
from app.db.session import get_db
from app.models.bill_member import BillMember
from app.models.user import User
from app.core.response import success_response, error_response
from app.schemas.payment import PaymentIntentCreate, PaymentOut
from app.services.payment_service import PaymentService

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Payments"])


@router.post("/payments/create-intent", status_code=201)
def create_payment_intent(
    body: PaymentIntentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        require_bill_participant(db, str(body.bill_id), str(current_user.id))
    except ValueError as e:
        code = str(e)
        if code == "NOT_FOUND":
            return error_response("NOT_FOUND", "Bill not found", 404)
        return error_response("FORBIDDEN", "Not authorized for this bill", 403)

    member = db.query(BillMember).filter(BillMember.id == body.member_id).first()
    if not member or str(member.bill_id) != str(body.bill_id):
        return error_response("BAD_REQUEST", "Member does not belong to this bill", 400)

    svc = PaymentService(db)
    try:
        payment = svc.create_payment_intent(
            bill_id=str(body.bill_id),
            member_id=str(body.member_id),
            user_id=str(current_user.id),
            amount=body.amount,
            currency=body.currency,
        )
    except ValueError as e:
        return error_response("PAYMENT_ERROR", str(e), 400)

    return success_response(
        data=PaymentOut.model_validate(payment).model_dump(),
        message="Payment intent created",
    )


@router.get("/payments/{payment_id}")
def get_payment(
    payment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = PaymentService(db)
    payment = svc.get_payment(str(payment_id))
    if not payment:
        return error_response("NOT_FOUND", "Payment not found", 404)

    try:
        require_bill_participant(db, str(payment.bill_id), str(current_user.id))
    except ValueError:
        return error_response("NOT_FOUND", "Payment not found", 404)

    out = PaymentOut.model_validate(payment).model_dump()
    out.pop("stripe_client_secret", None)
    return success_response(data=out)


@router.post("/payments/{payment_id}/confirm")
def confirm_payment(
    payment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = PaymentService(db)
    payment = svc.get_payment(str(payment_id))
    if not payment:
        return error_response("NOT_FOUND", "Payment not found", 404)

    try:
        require_bill_participant(db, str(payment.bill_id), str(current_user.id))
    except ValueError:
        return error_response("NOT_FOUND", "Payment not found", 404)

    if payment.status != "pending":
        return error_response("CONFLICT", f"Payment is already {payment.status}", 409)

    if settings.STRIPE_SECRET_KEY and payment.stripe_payment_intent_id:
        try:
            import stripe
            stripe.api_key = settings.STRIPE_SECRET_KEY
            pi = stripe.PaymentIntent.retrieve(payment.stripe_payment_intent_id)
            if pi.status != "succeeded":
                return error_response(
                    "PAYMENT_NOT_CONFIRMED",
                    f"Stripe PaymentIntent status is '{pi.status}', not 'succeeded'",
                    422,
                )
        except Exception as e:
            logger.warning("Stripe PI verification failed: %s", e)
            return error_response("PAYMENT_VERIFICATION_FAILED", str(e), 502)
    else:
        logger.info(
            "confirm_payment_no_stripe_verification",
            extra={"payment_id": str(payment_id)},
        )

    try:
        payment = svc.confirm_payment(str(payment_id))
    except ValueError:
        return error_response("NOT_FOUND", "Payment not found", 404)

    return success_response(
        data=PaymentOut.model_validate(payment).model_dump(),
        message="Payment confirmed",
    )


@router.get("/bills/{bill_id}/payments")
def get_bill_payments(
    bill_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        require_bill_participant(db, str(bill_id), str(current_user.id))
    except ValueError as e:
        code = str(e)
        if code == "NOT_FOUND":
            return error_response("NOT_FOUND", "Bill not found", 404)
        return error_response("FORBIDDEN", "Not authorized", 403)

    svc = PaymentService(db)
    payments = svc.get_bill_payments(str(bill_id))
    payments_data = []
    for p in payments:
        out = PaymentOut.model_validate(p).model_dump()
        out.pop("stripe_client_secret", None)
        payments_data.append(out)
    return success_response(data=payments_data)


@router.post("/webhooks/stripe")
async def stripe_webhook(
    request: Request,
    db: Session = Depends(get_db),
):
    if not settings.STRIPE_WEBHOOK_SECRET:
        return error_response(
            "WEBHOOK_NOT_CONFIGURED",
            "Stripe webhook secret is not configured",
            503,
        )

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    svc = PaymentService(db)
    try:
        svc.handle_stripe_webhook(payload, sig_header)
    except ValueError as e:
        return error_response("WEBHOOK_ERROR", str(e), 400)

    return success_response(message="Webhook processed")
