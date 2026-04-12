import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import SessionLocal, get_db
from app.models.bill import Bill
from app.models.user import User
from app.core.response import success_response, error_response
from app.schemas.item_assignment import (
    AssignmentBulkCreate,
    AssignmentUpdate,
    AssignmentOut,
    AutoSplitRequest,
)
from app.services.calculation_service import CalculationService
from app.services.payment_notification_service import PaymentNotificationService

router = APIRouter(prefix="/bills/{bill_id}", tags=["Assignments"])
logger = logging.getLogger(__name__)


def _schedule_payment_sms(bill_id: str, owner_id: str) -> None:
    db = SessionLocal()
    try:
        PaymentNotificationService(db).sync_request_sms_for_bill(bill_id, owner_id)
    except Exception:
        logger.exception("Payment notification SMS failed for bill %s", bill_id)
    finally:
        db.close()


def _assignment_out(assignment) -> dict:
    """Serialize an assignment with item_name and member_nickname populated."""
    assignment.item_name = assignment.item.name if assignment.item else None
    assignment.member_nickname = assignment.member.nickname if assignment.member else None
    return AssignmentOut.model_validate(assignment).model_dump()


@router.post("/assignments")
def create_assignments(
    bill_id: uuid.UUID,
    body: AssignmentBulkCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = CalculationService(db)
    assignments_dicts = [a.model_dump() for a in body.assignments]
    try:
        assignments = svc.create_assignments(str(bill_id), assignments_dicts)
    except ValueError as e:
        return error_response("BAD_REQUEST", str(e), 400)

    if body.send_payment_notifications:
        bill = db.query(Bill).filter(Bill.id == bill_id).first()
        if bill and str(bill.owner_id) == str(current_user.id):
            background_tasks.add_task(
                _schedule_payment_sms,
                str(bill_id),
                str(current_user.id),
            )

    # Refresh relationships for serialization
    for a in assignments:
        db.refresh(a)
    results = []
    for a in assignments:
        a.item_name = a.item.name if a.item else None
        a.member_nickname = a.member.nickname if a.member else None
        results.append(AssignmentOut.model_validate(a).model_dump())

    return success_response(data=results, message="Assignments created")


@router.get("/assignments")
def list_assignments(
    bill_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = CalculationService(db)
    assignments = svc.get_assignments(str(bill_id))
    results = [_assignment_out(a) for a in assignments]
    return success_response(data=results)


@router.patch("/assignments/{assignment_id}")
def update_assignment(
    bill_id: uuid.UUID,
    assignment_id: uuid.UUID,
    body: AssignmentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = CalculationService(db)
    try:
        assignment = svc.update_assignment(
            str(assignment_id),
            body.model_dump(exclude_unset=True),
        )
    except ValueError:
        return error_response("NOT_FOUND", "Assignment not found", 404)

    db.refresh(assignment)
    assignment.item_name = assignment.item.name if assignment.item else None
    assignment.member_nickname = assignment.member.nickname if assignment.member else None
    return success_response(
        data=AssignmentOut.model_validate(assignment).model_dump(),
        message="Assignment updated",
    )


@router.delete("/assignments/{assignment_id}")
def delete_assignment(
    bill_id: uuid.UUID,
    assignment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = CalculationService(db)
    try:
        svc.delete_assignment(str(assignment_id))
    except ValueError:
        return error_response("NOT_FOUND", "Assignment not found", 404)

    return success_response(message="Assignment deleted")


@router.post("/assignments/auto-split")
def auto_split(
    bill_id: uuid.UUID,
    body: AutoSplitRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = CalculationService(db)
    member_ids = [str(mid) for mid in body.member_ids] if body.member_ids else None
    assignments = svc.auto_split(str(bill_id), member_ids)

    if body.send_payment_notifications:
        bill = db.query(Bill).filter(Bill.id == bill_id).first()
        if bill and str(bill.owner_id) == str(current_user.id):
            background_tasks.add_task(
                _schedule_payment_sms,
                str(bill_id),
                str(current_user.id),
            )

    # Refresh relationships for serialization
    for a in assignments:
        db.refresh(a)
    results = []
    for a in assignments:
        a.item_name = a.item.name if a.item else None
        a.member_nickname = a.member.nickname if a.member else None
        results.append(AssignmentOut.model_validate(a).model_dump())

    return success_response(data=results, message="Auto-split completed")


@router.post("/recalculate")
def recalculate(
    bill_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = CalculationService(db)
    result = svc.recalculate(str(bill_id))
    return success_response(data=result, message="Recalculation complete")


@router.get("/balance-breakdown")
def get_balance_breakdown(
    bill_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = CalculationService(db)
    try:
        breakdown = svc.get_balance_breakdown(str(bill_id))
    except ValueError:
        return error_response("NOT_FOUND", "Bill not found", 404)

    return success_response(data=breakdown)


@router.get("/member-balances")
def get_member_balances(
    bill_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = CalculationService(db)
    try:
        balances = svc.get_member_balances(str(bill_id))
    except ValueError:
        return error_response("NOT_FOUND", "Bill not found", 404)

    return success_response(data=balances)
