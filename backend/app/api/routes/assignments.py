import asyncio
import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
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
from app.services.ws_manager import bill_ws_manager, schedule_broadcast

router = APIRouter(prefix="/bills/{bill_id}", tags=["Assignments"])
logger = logging.getLogger(__name__)


def _dispatch_payment_sms(bill_id: str, owner_id: str) -> None:
    """Fan out payment-request SMS. Uses Celery when a broker is configured so
    we never tie up the HTTP worker on Twilio latency."""
    if settings.CELERY_BROKER_URL:
        try:
            from app.celery_app import celery_app

            celery_app.send_task(
                "notifications.request_payment_sms",
                kwargs={"bill_id": bill_id, "owner_id": owner_id},
            )
            return
        except Exception:
            logger.exception("Celery dispatch failed; running SMS inline for bill %s", bill_id)

    from app.services.payment_notification_service import PaymentNotificationService

    db = SessionLocal()
    try:
        PaymentNotificationService(db).sync_request_sms_for_bill(bill_id, owner_id)
    except Exception:
        logger.exception("Payment notification SMS failed for bill %s", bill_id)
    finally:
        db.close()


def _delta_payload(
    action: str,
    receipt_item_id: str | None = None,
    bill_member_id: str | None = None,
    assignment_id: str | None = None,
    client_mutation_id: str | None = None,
) -> dict:
    payload: dict = {"action": action}
    if receipt_item_id is not None:
        payload["receipt_item_id"] = receipt_item_id
    if bill_member_id is not None:
        payload["bill_member_id"] = bill_member_id
    if assignment_id is not None:
        payload["assignment_id"] = assignment_id
    if client_mutation_id is not None:
        payload["client_mutation_id"] = client_mutation_id
    return payload


def _broadcast_delta_now(bill_id: str, payload: dict) -> None:
    """Fire an `assignment_update` broadcast without waiting for BackgroundTasks.

    BackgroundTasks run *after* the response is sent and behind any other
    queued task (e.g. the Twilio SMS fan-out), which used to add 500-1500ms
    of latency before receivers saw the change. Scheduling onto the running
    loop means the broadcast leaves the server on the same tick as the
    response."""
    if bill_ws_manager.client_count(bill_id) == 0:
        return
    schedule_broadcast(bill_ws_manager.broadcast(bill_id, "assignment_update", payload))


def _load_full_sync_payload(bill_id: str, client_mutation_id: str | None = None) -> dict:
    """Synchronously load the full assignment list for a bill (run in a threadpool)."""
    db = SessionLocal()
    try:
        svc = CalculationService(db)
        assignments = svc.get_assignments(bill_id)
        payload: dict = {
            "action": "full_sync",
            "assignments": [_assignment_out(a) for a in assignments],
        }
        if client_mutation_id is not None:
            payload["client_mutation_id"] = client_mutation_id
        return payload
    finally:
        db.close()


async def _broadcast_full_sync(bill_id: str, client_mutation_id: str | None = None) -> None:
    """Send the entire assignment list (used after bulk operations like auto-split)."""
    if bill_ws_manager.client_count(bill_id) == 0:
        return
    try:
        payload = await asyncio.to_thread(_load_full_sync_payload, bill_id, client_mutation_id)
        await bill_ws_manager.broadcast(bill_id, "assignment_update", payload)
    except Exception:
        logger.exception("WS full_sync broadcast failed for bill %s", bill_id)


def _assignment_out(assignment) -> dict:
    """Serialize an assignment with item_name and member_nickname populated."""
    assignment.item_name = assignment.item.name if assignment.item else None
    assignment.member_nickname = assignment.member.nickname if assignment.member else None
    return AssignmentOut.model_validate(assignment).model_dump(mode="json")


@router.post("/assignments")
def create_assignments(
    bill_id: uuid.UUID,
    body: AssignmentBulkCreate,
    background_tasks: BackgroundTasks,
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

    svc = CalculationService(db)
    assignments_dicts = [a.model_dump() for a in body.assignments]
    try:
        assignments = svc.create_assignments(str(bill_id), assignments_dicts)
    except ValueError as e:
        return error_response("BAD_REQUEST", str(e), 400)

    # Refresh relationships for serialization
    for a in assignments:
        db.refresh(a)
    results = []
    for a in assignments:
        a.item_name = a.item.name if a.item else None
        a.member_nickname = a.member.nickname if a.member else None
        results.append(AssignmentOut.model_validate(a).model_dump())

    # Broadcast BEFORE scheduling SMS so the fan-out never delays the WS frame.
    for r in results:
        _broadcast_delta_now(
            str(bill_id),
            _delta_payload(
                "added",
                str(r.get("receipt_item_id", "")),
                str(r.get("bill_member_id", "")),
                str(r.get("id", "")),
                body.client_mutation_id,
            ),
        )

    if body.send_payment_notifications:
        bill = db.query(Bill).filter(Bill.id == bill_id).first()
        if bill and str(bill.owner_id) == str(current_user.id):
            background_tasks.add_task(
                _dispatch_payment_sms,
                str(bill_id),
                str(current_user.id),
            )

    return success_response(data=results, message="Assignments created")


@router.get("/assignments")
def list_assignments(
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

    svc = CalculationService(db)
    assignments = svc.get_assignments(str(bill_id))
    results = [_assignment_out(a) for a in assignments]
    return success_response(data=results)


@router.patch("/assignments/{assignment_id}")
def update_assignment(
    bill_id: uuid.UUID,
    assignment_id: uuid.UUID,
    body: AssignmentUpdate,
    background_tasks: BackgroundTasks,
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

    _broadcast_delta_now(
        str(bill_id),
        _delta_payload(
            "updated",
            str(assignment.receipt_item_id),
            str(assignment.bill_member_id),
            str(assignment.id),
            body.client_mutation_id,
        ),
    )

    return success_response(
        data=AssignmentOut.model_validate(assignment).model_dump(),
        message="Assignment updated",
    )


@router.delete("/assignments/{assignment_id}")
def delete_assignment(
    bill_id: uuid.UUID,
    assignment_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    client_mutation_id: str | None = None,
):
    svc = CalculationService(db)
    from app.models.item_assignment import ItemAssignment
    assignment = db.query(ItemAssignment).filter(ItemAssignment.id == assignment_id).first()
    if not assignment:
        return error_response("NOT_FOUND", "Assignment not found", 404)
    item_id = str(assignment.receipt_item_id)
    member_id = str(assignment.bill_member_id)

    try:
        svc.delete_assignment(str(assignment_id))
    except ValueError:
        return error_response("NOT_FOUND", "Assignment not found", 404)

    _broadcast_delta_now(
        str(bill_id),
        _delta_payload(
            "removed",
            item_id,
            member_id,
            str(assignment_id),
            client_mutation_id,
        ),
    )

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

    # Refresh relationships for serialization
    for a in assignments:
        db.refresh(a)
    results = []
    for a in assignments:
        a.item_name = a.item.name if a.item else None
        a.member_nickname = a.member.nickname if a.member else None
        results.append(AssignmentOut.model_validate(a).model_dump())

    # Fire full-sync first (bulk op — a single frame is cheaper than N deltas).
    background_tasks.add_task(_broadcast_full_sync, str(bill_id), body.client_mutation_id)

    if body.send_payment_notifications:
        bill = db.query(Bill).filter(Bill.id == bill_id).first()
        if bill and str(bill.owner_id) == str(current_user.id):
            background_tasks.add_task(
                _dispatch_payment_sms,
                str(bill_id),
                str(current_user.id),
            )

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
    from app.api.deps_bill import require_bill_participant

    try:
        require_bill_participant(db, str(bill_id), str(current_user.id))
    except ValueError as e:
        code = str(e)
        if code == "NOT_FOUND":
            return error_response("NOT_FOUND", "Bill not found", 404)
        return error_response("FORBIDDEN", "Not authorized", 403)

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
    from app.api.deps_bill import require_bill_participant

    try:
        require_bill_participant(db, str(bill_id), str(current_user.id))
    except ValueError as e:
        code = str(e)
        if code == "NOT_FOUND":
            return error_response("NOT_FOUND", "Bill not found", 404)
        return error_response("FORBIDDEN", "Not authorized", 403)

    svc = CalculationService(db)
    try:
        balances = svc.get_member_balances(str(bill_id))
    except ValueError:
        return error_response("NOT_FOUND", "Bill not found", 404)

    return success_response(data=balances)
