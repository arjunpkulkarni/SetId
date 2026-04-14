import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.response import error_response, success_response
from app.db.session import get_db
from app.models.user import User
from app.schemas.payment_method import (
    AttachPaymentMethodRequest,
    PaymentMethodOut,
    SetupIntentOut,
)
from app.services.payment_method_service import PaymentMethodService

router = APIRouter(prefix="/payment-methods", tags=["Payment Methods"])


@router.get("")
def list_payment_methods(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = PaymentMethodService(db)
    methods = svc.list_payment_methods(str(current_user.id))
    return success_response(
        data=[PaymentMethodOut.model_validate(m).model_dump() for m in methods]
    )


@router.post("/setup-intent", status_code=201)
def create_setup_intent(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = PaymentMethodService(db)
    result = svc.create_setup_intent(current_user)
    return success_response(data=result, message="SetupIntent created")


@router.post("/attach", status_code=201)
def attach_payment_method(
    body: AttachPaymentMethodRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = PaymentMethodService(db)
    try:
        method = svc.attach_payment_method(current_user, body.payment_method_id)
    except Exception as e:
        return error_response("ATTACH_FAILED", str(e), 400)

    return success_response(
        data=PaymentMethodOut.model_validate(method).model_dump(),
        message="Payment method saved",
    )


@router.post("/{method_id}/default")
def set_default_payment_method(
    method_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = PaymentMethodService(db)
    try:
        method = svc.set_default(str(current_user.id), str(method_id))
    except ValueError:
        return error_response("NOT_FOUND", "Payment method not found", 404)

    return success_response(
        data=PaymentMethodOut.model_validate(method).model_dump(),
        message="Default payment method updated",
    )


@router.delete("/{method_id}")
def delete_payment_method(
    method_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = PaymentMethodService(db)
    try:
        svc.delete_payment_method(str(current_user.id), str(method_id))
    except ValueError:
        return error_response("NOT_FOUND", "Payment method not found", 404)

    return success_response(message="Payment method removed")
