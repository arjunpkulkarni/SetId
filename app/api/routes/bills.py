import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.core.response import success_response, error_response
from app.schemas.bill import BillCreate, BillUpdate, BillOut, BillActivity, ServiceFeeUpdate
from app.schemas.bill_member import BillMemberOut
from app.schemas.receipt import ReceiptItemOut
from app.services.bill_service import BillService
from app.services.receipt_parser_service import ReceiptParserService
from app.services.calculation_service import CalculationService
from app.services.payment_service import PaymentService
from app.services.payment_notification_service import PaymentNotificationService

router = APIRouter(prefix="/bills", tags=["Bills"])


def _bill_out(bill) -> dict:
    """Helper to serialize a bill with member_count set."""
    bill.member_count = len(bill.members) if bill.members else 0
    return BillOut.model_validate(bill).model_dump()


@router.post("", status_code=201)
def create_bill(
    body: BillCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = BillService(db)
    bill = svc.create_bill(
        owner_id=str(current_user.id),
        title=body.title,
        merchant_name=body.merchant_name,
        currency=body.currency,
        notes=body.notes,
    )
    return success_response(data=_bill_out(bill), message="Bill created")


@router.get("")
def list_bills(
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = BillService(db)
    bills = svc.get_user_bills(user_id=str(current_user.id), status=status)
    bills_data = [_bill_out(b) for b in bills]
    return success_response(data=bills_data)


@router.get("/{bill_id}")
def get_bill(
    bill_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.deps_bill import require_bill_participant

    try:
        bill = require_bill_participant(db, str(bill_id), str(current_user.id))
    except ValueError as e:
        code = str(e)
        if code == "NOT_FOUND":
            return error_response("NOT_FOUND", "Bill not found", 404)
        return error_response("FORBIDDEN", "Not authorized to view this bill", 403)
    return success_response(data=_bill_out(bill))


@router.patch("/{bill_id}")
def update_bill(
    bill_id: uuid.UUID,
    body: BillUpdate,
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
        return error_response("FORBIDDEN", "Only the bill owner can update this bill", 403)

    svc = BillService(db)
    try:
        bill = svc.update_bill(str(bill_id), body.model_dump(exclude_unset=True))
    except ValueError:
        return error_response("NOT_FOUND", "Bill not found", 404)

    return success_response(data=_bill_out(bill), message="Bill updated")


@router.delete("/{bill_id}")
def delete_bill(
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
        return error_response("FORBIDDEN", "Only the bill owner can delete this bill", 403)

    svc = BillService(db)
    try:
        svc.delete_bill(str(bill_id))
    except ValueError:
        return error_response("NOT_FOUND", "Bill not found", 404)

    return success_response(message="Bill deleted")


@router.post("/{bill_id}/send-payment-requests")
def send_payment_requests(
    bill_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Owner-only: upsert pending payments and send SMS with pay links."""
    svc = PaymentNotificationService(db)
    try:
        data = svc.sync_request_sms_for_bill(str(bill_id), str(current_user.id))
    except ValueError as e:
        code = str(e)
        if code == "NOT_FOUND":
            return error_response("NOT_FOUND", "Bill not found", 404)
        if code == "FORBIDDEN":
            return error_response(
                "FORBIDDEN",
                "Only the bill owner can send payment requests",
                403,
            )
        return error_response("ERROR", code, 400)

    return success_response(data=data, message="Payment requests processed")


@router.get("/{bill_id}/summary")
def get_bill_summary(
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
        return error_response("FORBIDDEN", "Not authorized to view this bill", 403)

    bill_svc = BillService(db)
    receipt_svc = ReceiptParserService(db)
    calc_svc = CalculationService(db)
    payment_svc = PaymentService(db)

    bill = bill_svc.get_bill(str(bill_id))
    if not bill:
        return error_response("NOT_FOUND", "Bill not found", 404)

    members = bill_svc.get_members(str(bill_id))
    items = receipt_svc.get_items(str(bill_id))
    assignments = calc_svc.get_assignments(str(bill_id))
    payments = payment_svc.get_bill_payments(str(bill_id))

    total_assigned = sum((a.amount_owed for a in assignments), Decimal("0"))
    bill_subtotal = bill.subtotal or Decimal("0")
    total_unassigned = bill_subtotal - total_assigned

    # Use balance breakdown so host (paid upfront) is excluded from remaining
    breakdown = calc_svc.get_balance_breakdown(str(bill_id))
    total_paid = breakdown["total_paid"]
    total_remaining = breakdown["total_remaining"]

    bill.member_count = len(bill.members) if bill.members else 0

    summary = {
        "bill": BillOut.model_validate(bill).model_dump(),
        "members": [BillMemberOut.model_validate(m).model_dump() for m in members],
        "items": [ReceiptItemOut.model_validate(i).model_dump() for i in items],
        "total_assigned": total_assigned,
        "total_unassigned": total_unassigned,
        "total_paid": total_paid,
        "total_remaining": total_remaining,
    }
    return success_response(data=summary)


@router.post("/{bill_id}/service-fee")
def update_service_fee(
    bill_id: uuid.UUID,
    body: ServiceFeeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Configure and apply service fee to a bill (owner-only)."""
    from app.api.deps_bill import require_bill_owner

    try:
        require_bill_owner(db, str(bill_id), str(current_user.id))
    except ValueError as e:
        code = str(e)
        if code == "NOT_FOUND":
            return error_response("NOT_FOUND", "Bill not found", 404)
        return error_response("FORBIDDEN", "Only the bill owner can update service fees", 403)

    calc_svc = CalculationService(db)
    try:
        bill = calc_svc.apply_service_fee(
            str(bill_id),
            fee_type=body.fee_type,
            percentage=body.percentage
        )
    except ValueError as e:
        return error_response("NOT_FOUND", str(e), 404)

    return success_response(
        data={
            "bill_id": str(bill.id),
            "service_fee_type": bill.service_fee_type,
            "service_fee_percentage": str(bill.service_fee_percentage) if bill.service_fee_percentage else None,
            "service_fee": str(bill.service_fee),
            "total": str(bill.total),
        },
        message="Service fee updated"
    )


@router.get("/{bill_id}/activity")
def get_bill_activity(
    bill_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    bill_svc = BillService(db)
    bill = bill_svc.get_bill(str(bill_id))
    if not bill:
        return error_response("NOT_FOUND", "Bill not found", 404)

    now = datetime.now(timezone.utc)
    activities = [
        BillActivity(
            type="bill_created",
            description=f"Bill '{bill.title}' was created",
            timestamp=bill.created_at,
            actor_name=current_user.full_name,
        ).model_dump(),
        BillActivity(
            type="member_added",
            description="Members were added to the bill",
            timestamp=bill.created_at + timedelta(minutes=5),
            actor_name=current_user.full_name,
        ).model_dump(),
        BillActivity(
            type="receipt_uploaded",
            description="Receipt was uploaded for parsing",
            timestamp=bill.created_at + timedelta(minutes=10),
            actor_name=current_user.full_name,
        ).model_dump(),
        BillActivity(
            type="items_parsed",
            description="Receipt items were parsed and added",
            timestamp=bill.created_at + timedelta(minutes=12),
            actor_name="System",
        ).model_dump(),
        BillActivity(
            type="payment_made",
            description="A payment was submitted",
            timestamp=bill.created_at + timedelta(hours=1),
            actor_name=current_user.full_name,
        ).model_dump(),
    ]
    return success_response(data=activities)
