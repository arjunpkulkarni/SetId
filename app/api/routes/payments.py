import uuid

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.core.response import success_response, error_response
from app.schemas.payment import PaymentIntentCreate, PaymentOut
from app.services.payment_service import PaymentService

router = APIRouter(tags=["Payments"])


@router.post("/payments/create-intent", status_code=201)
def create_payment_intent(
    body: PaymentIntentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
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

    return success_response(data=PaymentOut.model_validate(payment).model_dump())


@router.post("/payments/{payment_id}/confirm")
def confirm_payment(
    payment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = PaymentService(db)
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
    svc = PaymentService(db)
    payments = svc.get_bill_payments(str(bill_id))
    payments_data = [PaymentOut.model_validate(p).model_dump() for p in payments]
    return success_response(data=payments_data)


@router.post("/webhooks/stripe")
async def stripe_webhook(
    request: Request,
    db: Session = Depends(get_db),
):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    svc = PaymentService(db)
    try:
        svc.handle_stripe_webhook(payload, sig_header)
    except ValueError as e:
        return error_response("WEBHOOK_ERROR", str(e), 400)

    return success_response(message="Webhook processed")
