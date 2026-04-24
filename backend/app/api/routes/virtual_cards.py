import logging
import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.response import error_response, success_response
from app.db.session import get_db
from app.models.user import User
from app.schemas.bill import MarkReadyRequest, ReadinessOut
from app.schemas.virtual_card import VirtualCardOut, VirtualCardSummary
from app.services.readiness_service import ReadinessService
from app.services.virtual_card_service import VirtualCardService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/bills/{bill_id}", tags=["Readiness & Virtual Cards"])


@router.get("/readiness")
def get_readiness(
    bill_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.deps_bill import require_bill_participant

    try:
        require_bill_participant(db, str(bill_id), str(current_user.id))
    except ValueError as e:
        code = str(e)
        if code == "NOT_FOUND":
            return error_response("NOT_FOUND", "Bill not found", 404)
        return error_response("FORBIDDEN", "Not authorized", 403)

    svc = ReadinessService(db)
    try:
        result = svc.evaluate(str(bill_id))
    except ValueError as e:
        if str(e) == "NOT_FOUND":
            return error_response("NOT_FOUND", "Bill not found", 404)
        return error_response("ERROR", str(e), 400)

    return success_response(data=result)


@router.post("/mark-ready")
def mark_ready(
    bill_id: uuid.UUID,
    body: MarkReadyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = ReadinessService(db)
    try:
        bill = svc.mark_ready(
            bill_id=str(bill_id),
            actor_id=str(current_user.id),
            reason=body.reason,
        )
    except ValueError as e:
        code = str(e)
        if code == "NOT_FOUND":
            return error_response("NOT_FOUND", "Bill not found", 404)
        if code == "FORBIDDEN":
            return error_response(
                "FORBIDDEN", "Only the bill owner can mark as ready", 403
            )
        if code == "ALREADY_READY":
            return error_response("CONFLICT", "Bill is already marked ready", 409)
        if code == "THRESHOLD_NOT_MET":
            return error_response(
                "PRECONDITION_FAILED",
                "100% of the bill total must be collected before marking ready",
                422,
            )
        return error_response("ERROR", code, 400)

    from app.schemas.bill import BillOut

    real_members = [m for m in (bill.members or []) if m.status != "invite_link"]
    bill.member_count = len(real_members)
    return success_response(
        data=BillOut.model_validate(bill).model_dump(),
        message="Bill marked ready to pay",
    )


@router.post("/unmark-ready")
def unmark_ready(
    bill_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = ReadinessService(db)
    try:
        bill = svc.unmark_ready(str(bill_id), str(current_user.id))
    except ValueError as e:
        code = str(e)
        if code == "NOT_FOUND":
            return error_response("NOT_FOUND", "Bill not found", 404)
        if code == "FORBIDDEN":
            return error_response(
                "FORBIDDEN", "Only the bill owner can change readiness", 403
            )
        if code == "ACTIVE_CARD_EXISTS":
            return error_response(
                "CONFLICT",
                "Deactivate the virtual card before revoking readiness",
                409,
            )
        return error_response("ERROR", code, 400)

    from app.schemas.bill import BillOut

    real_members = [m for m in (bill.members or []) if m.status != "invite_link"]
    bill.member_count = len(real_members)
    return success_response(
        data=BillOut.model_validate(bill).model_dump(),
        message="Readiness revoked",
    )


@router.post("/virtual-card/create", status_code=201)
def create_virtual_card(
    bill_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not settings.FEATURE_VIRTUAL_CARDS:
        return error_response(
            "FEATURE_DISABLED", "Virtual card feature is not enabled", 403
        )

    svc = VirtualCardService(db)
    try:
        card = svc.create_card_for_bill(
            bill_id=str(bill_id),
            actor_id=str(current_user.id),
        )
    except ValueError as e:
        code = str(e)
        if code == "NOT_FOUND":
            return error_response("NOT_FOUND", "Bill not found", 404)
        if code == "FORBIDDEN":
            return error_response(
                "FORBIDDEN", "Only the bill owner can create a virtual card", 403
            )
        if code == "NOT_READY":
            return error_response(
                "PRECONDITION_FAILED",
                "Bill must be ready to pay before creating a virtual card",
                422,
            )
        return error_response("ERROR", code, 400)

    return success_response(
        data=VirtualCardOut.model_validate(card).model_dump(),
        message="Virtual card created",
    )


@router.get("/virtual-card")
def get_virtual_card(
    bill_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.deps_bill import require_bill_owner

    try:
        require_bill_owner(db, str(bill_id), str(current_user.id))
    except ValueError as e:
        code = str(e)
        if code == "NOT_FOUND":
            return error_response("NOT_FOUND", "Bill not found", 404)
        return error_response("FORBIDDEN", "Only the bill owner can view card details", 403)

    svc = VirtualCardService(db)
    card = svc.get_card_for_bill(str(bill_id))
    if not card:
        return error_response("NOT_FOUND", "No active virtual card for this bill", 404)

    return success_response(
        data=VirtualCardSummary.model_validate(card).model_dump(),
    )


@router.post("/virtual-card/deactivate")
def deactivate_virtual_card(
    bill_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = VirtualCardService(db)
    card = svc.get_card_for_bill(str(bill_id))
    if not card:
        return error_response("NOT_FOUND", "No active virtual card for this bill", 404)

    try:
        card = svc.deactivate_card(str(card.id), str(current_user.id))
    except ValueError as e:
        code = str(e)
        if code == "FORBIDDEN":
            return error_response(
                "FORBIDDEN", "Only the bill owner can deactivate the card", 403
            )
        return error_response("ERROR", code, 400)

    return success_response(
        data=VirtualCardSummary.model_validate(card).model_dump(),
        message="Virtual card deactivated",
    )
