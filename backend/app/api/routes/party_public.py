"""Public guest endpoints for the web bill-splitting flow. No authentication required —
the invite token serves as the credential."""

import asyncio
import logging
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.response import error_response, success_response
from app.db.session import SessionLocal, get_db
from app.models.bill import Bill
from app.models.bill_member import BillMember
from app.models.item_assignment import ItemAssignment
from app.models.receipt_item import ReceiptItem
from app.services.calculation_service import CalculationService
from app.services.guest_pay_gate import assert_guest_payment_allowed
from app.services.payment_service import PaymentService
from app.services.ws_manager import bill_ws_manager, schedule_broadcast

router = APIRouter(prefix="/party", tags=["Party (public)"])
logger = logging.getLogger(__name__)


# ── Request schemas ──────────────────────────────────────────────

class JoinRequest(BaseModel):
    nickname: str


class ClaimAction(BaseModel):
    receipt_item_id: str
    action: str  # "claim" | "unclaim"


class ClaimRequest(BaseModel):
    claims: list[ClaimAction]
    # Echoed back in the WS broadcast so the originating client can ignore
    # its own event and keep its already-rendered state.
    client_mutation_id: str | None = None


class EvenSplitRequest(BaseModel):
    client_mutation_id: str | None = None


# ── Helpers ──────────────────────────────────────────────────────

def _get_member_by_token(db: Session, token: str) -> BillMember | None:
    return db.query(BillMember).filter(BillMember.invite_token == token).first()


def _build_receipt_response(db: Session, bill: Bill, members: list[BillMember]) -> dict:
    items = (
        db.query(ReceiptItem)
        .filter(ReceiptItem.bill_id == bill.id)
        .order_by(ReceiptItem.sort_order)
        .all()
    )
    item_ids = [item.id for item in items]

    assignments = []
    if item_ids:
        assignments = (
            db.query(ItemAssignment)
            .filter(ItemAssignment.receipt_item_id.in_(item_ids))
            .all()
        )

    member_map = {str(m.id): m.nickname for m in members}

    items_out = []
    for item in items:
        claimed_by = []
        for a in assignments:
            if str(a.receipt_item_id) == str(item.id):
                claimed_by.append({
                    "member_id": str(a.bill_member_id),
                    "nickname": member_map.get(str(a.bill_member_id), "Unknown"),
                    "assignment_id": str(a.id),
                    "share_type": a.share_type,
                    "amount_owed": str(a.amount_owed),
                })
        items_out.append({
            "id": str(item.id),
            "name": item.name,
            "quantity": item.quantity,
            "unit_price": str(item.unit_price),
            "total_price": str(item.total_price),
            "claimed_by": claimed_by,
        })

    return {
        "bill": {
            "id": str(bill.id),
            "title": bill.title,
            "merchant_name": bill.merchant_name,
            "currency": bill.currency or "USD",
            "subtotal": str(bill.subtotal or 0),
            "tax": str(bill.tax or 0),
            "tip": str(bill.tip or 0),
            "tip_split_mode": bill.tip_split_mode or "proportional",
            "total": str(bill.total or 0),
            "guest_pay_unlocked": bool(getattr(bill, "guest_pay_unlocked", True)),
        },
        "members": [
            {"id": str(m.id), "nickname": m.nickname, "status": m.status}
            for m in members
        ],
        "items": items_out,
    }


def _load_assignments_payload(bill_id: str) -> list:
    """Synchronously load the full assignment list for a bill (run in a threadpool)."""
    from app.schemas.item_assignment import AssignmentOut

    db = SessionLocal()
    try:
        svc = CalculationService(db)
        assignments = svc.get_assignments(bill_id)
        payload = []
        for a in assignments:
            a.item_name = a.item.name if a.item else None
            a.member_nickname = a.member.nickname if a.member else None
            payload.append(AssignmentOut.model_validate(a).model_dump(mode="json"))
        return payload
    finally:
        db.close()


async def _broadcast_assignments(bill_id: str) -> None:
    if bill_ws_manager.client_count(bill_id) == 0:
        return
    try:
        payload = await asyncio.to_thread(_load_assignments_payload, bill_id)
        await bill_ws_manager.broadcast(bill_id, "assignment_update", payload)
    except Exception:
        logger.exception("WS broadcast failed for bill %s", bill_id)


def _broadcast_delta_now(bill_id: str, payload: dict) -> None:
    """Fire-and-forget assignment delta on the main loop (same pattern as
    `assignments.py`). Avoids queuing behind BackgroundTasks, which would
    delay receivers until after the response has been sent."""
    if bill_ws_manager.client_count(bill_id) == 0:
        return
    schedule_broadcast(bill_ws_manager.broadcast(bill_id, "assignment_update", payload))


def _load_item_assignments(db: Session, item_ids: set[str]) -> dict[str, list[dict]]:
    """Post-commit assignment snapshot per item, so broadcasts can carry
    authoritative amounts (including equal-split sibling recalc)."""
    if not item_ids:
        return {}
    from app.schemas.item_assignment import AssignmentOut
    from sqlalchemy.orm import joinedload as _joinedload

    rows = (
        db.query(ItemAssignment)
        .filter(ItemAssignment.receipt_item_id.in_(list(item_ids)))
        .options(
            _joinedload(ItemAssignment.item),
            _joinedload(ItemAssignment.member),
        )
        .all()
    )
    by_item: dict[str, list[dict]] = {str(iid): [] for iid in item_ids}
    for a in rows:
        a.item_name = a.item.name if a.item else None
        a.member_nickname = a.member.nickname if a.member else None
        by_item.setdefault(str(a.receipt_item_id), []).append(
            AssignmentOut.model_validate(a).model_dump(mode="json")
        )
    return by_item


async def _broadcast_event(bill_id: str, event: str, data: dict) -> None:
    try:
        await bill_ws_manager.broadcast(bill_id, event, data)
    except Exception:
        logger.exception("WS broadcast failed for bill %s", bill_id)


def _recalculate_equal_splits_for_item(db: Session, item: ReceiptItem) -> None:
    equal_assignments = (
        db.query(ItemAssignment)
        .filter(
            ItemAssignment.receipt_item_id == item.id,
            ItemAssignment.share_type == "equal",
        )
        .all()
    )
    if not equal_assignments:
        return
    per_person = (item.total_price / len(equal_assignments)).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
    for a in equal_assignments:
        a.amount_owed = per_person


# ── Endpoints ────────────────────────────────────────────────────

@router.post("/{token}/join")
def join_party(
    token: str,
    body: JoinRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Join a bill via an invite link.

    The supplied ``token`` may be either:
      * a shared-link placeholder token (``status == "invite_link"``) — in
        which case each caller becomes a **new** ``BillMember``, so N people
        can all join the same share link.
      * a per-guest personal token previously returned from this endpoint
        (``status == "joined"``) — idempotent: returns the existing member.
      * an individually-invited member's token (``status == "invited"``) —
        promotes that member to ``joined``.

    The response always includes ``member_token`` — a per-guest token the
    client MUST use for all subsequent ``/party/{token}/…`` calls (receipt,
    claim, confirm, payment-complete, ws). Reusing the original shared-link
    token would otherwise collide with other guests.
    """
    member = _get_member_by_token(db, token)
    if not member:
        return error_response("NOT_FOUND", "Invalid or expired invite link.", 404)

    bill = member.bill
    if not bill:
        return error_response("NOT_FOUND", "Bill not found.", 404)

    # Case 1: Shared-link placeholder → mint a fresh per-guest BillMember.
    # The placeholder itself is left untouched so subsequent guests can
    # keep joining through the same share link.
    if member.status == "invite_link":
        new_member = BillMember(
            bill_id=bill.id,
            nickname=body.nickname,
            status="joined",
            joined_at=datetime.now(timezone.utc),
            # invite_token auto-generated by BillMember's default factory
        )
        db.add(new_member)
        db.commit()
        db.refresh(new_member)

        members = (
            db.query(BillMember)
            .filter(
                BillMember.bill_id == bill.id,
                BillMember.status != "invite_link",
            )
            .all()
        )
        members_payload = [
            {"id": str(m.id), "nickname": m.nickname, "status": m.status}
            for m in members
        ]

        background_tasks.add_task(
            _broadcast_event,
            str(bill.id),
            "member_joined",
            {
                "member_id": str(new_member.id),
                "nickname": new_member.nickname,
                "members": members_payload,
            },
        )

        return success_response(data={
            "member_id": str(new_member.id),
            "member_token": new_member.invite_token,
            "nickname": new_member.nickname,
            "bill_id": str(bill.id),
            "bill_title": bill.title,
            "merchant_name": bill.merchant_name,
            "member_count": len(members),
        }, message="Joined successfully")

    # Case 2: Already joined via a personal token → idempotent return.
    if member.status == "joined":
        members = (
            db.query(BillMember)
            .filter(
                BillMember.bill_id == bill.id,
                BillMember.status != "invite_link",
            )
            .all()
        )
        return success_response(data={
            "member_id": str(member.id),
            "member_token": member.invite_token,
            "nickname": member.nickname,
            "bill_id": str(bill.id),
            "bill_title": bill.title,
            "merchant_name": bill.merchant_name,
            "member_count": len(members),
        }, message="Already joined")

    # Case 3: Individually-invited member (status == "invited" etc.) → promote.
    member.nickname = body.nickname
    member.status = "joined"
    member.joined_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(member)

    members = (
        db.query(BillMember)
        .filter(
            BillMember.bill_id == bill.id,
            BillMember.status != "invite_link",
        )
        .all()
    )
    members_payload = [
        {"id": str(m.id), "nickname": m.nickname, "status": m.status}
        for m in members
    ]

    background_tasks.add_task(
        _broadcast_event,
        str(bill.id),
        "member_joined",
        {
            "member_id": str(member.id),
            "nickname": member.nickname,
            "members": members_payload,
        },
    )
    # Deliberately NOT firing `_broadcast_assignments` here — nothing about
    # assignments changes when a guest joins. The old code fired an empty
    # `assignment_update []` broadcast to every connected client, each of
    # which triggered a wasted `/bills/:id/summary` refetch. On the host's
    # phone that stale-cached refetch was even overwriting the freshly
    # applied `member_joined` state, making joins appear to silently revert.

    return success_response(data={
        "member_id": str(member.id),
        "member_token": member.invite_token,
        "nickname": member.nickname,
        "bill_id": str(bill.id),
        "bill_title": bill.title,
        "merchant_name": bill.merchant_name,
        "member_count": len(members),
    }, message="Joined successfully")


@router.get("/{token}/receipt")
def get_receipt(token: str, db: Session = Depends(get_db)):
    member = _get_member_by_token(db, token)
    if not member:
        return error_response("NOT_FOUND", "Invalid or expired invite link.", 404)

    if member.status not in ("joined", "invite_link"):
        return error_response("BAD_REQUEST", "You must join the bill first.", 400)

    bill = member.bill
    if not bill:
        return error_response("NOT_FOUND", "Bill not found.", 404)

    members = (
        db.query(BillMember)
        .filter(
            BillMember.bill_id == bill.id,
            BillMember.status != "invite_link",
        )
        .all()
    )
    return success_response(data=_build_receipt_response(db, bill, members))


@router.post("/{token}/even-split")
def even_split_receipt(
    token: str,
    body: EvenSplitRequest,
    db: Session = Depends(get_db),
):
    member = _get_member_by_token(db, token)
    if not member:
        return error_response("NOT_FOUND", "Invalid or expired invite link.", 404)

    if member.status != "joined":
        return error_response("BAD_REQUEST", "You must join the bill first.", 400)

    bill = member.bill
    if not bill:
        return error_response("NOT_FOUND", "Bill not found.", 404)

    bill_id_str = str(bill.id)
    CalculationService(db).auto_split(bill_id_str)

    payload: dict = {
        "action": "full_sync",
        "assignments": _load_assignments_payload(bill_id_str),
    }
    if body.client_mutation_id is not None:
        payload["client_mutation_id"] = body.client_mutation_id
    _broadcast_delta_now(bill_id_str, payload)

    members = (
        db.query(BillMember)
        .filter(
            BillMember.bill_id == bill.id,
            BillMember.status != "invite_link",
        )
        .all()
    )
    return success_response(
        data=_build_receipt_response(db, bill, members),
        message="Receipt split evenly",
    )


@router.post("/{token}/claim")
def claim_items(
    token: str,
    body: ClaimRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    member = _get_member_by_token(db, token)
    if not member:
        return error_response("NOT_FOUND", "Invalid or expired invite link.", 404)

    if member.status != "joined":
        return error_response("BAD_REQUEST", "You must join the bill first.", 400)

    bill = member.bill
    if not bill:
        return error_response("NOT_FOUND", "Bill not found.", 404)

    bill_id_str = str(bill.id)
    member_id_str = str(member.id)

    affected_item_ids: set[str] = set()
    # (action, item_id, assignment_id) tuples for post-commit delta broadcast.
    deltas: list[tuple[str, str, str]] = []

    for claim in body.claims:
        item = (
            db.query(ReceiptItem)
            .filter(ReceiptItem.id == claim.receipt_item_id, ReceiptItem.bill_id == bill.id)
            .first()
        )
        if not item:
            return error_response("NOT_FOUND", f"Item {claim.receipt_item_id} not found.", 404)

        if claim.action == "claim":
            existing = (
                db.query(ItemAssignment)
                .filter(
                    ItemAssignment.receipt_item_id == item.id,
                    ItemAssignment.bill_member_id == member.id,
                )
                .first()
            )
            if not existing:
                assignment = ItemAssignment(
                    receipt_item_id=item.id,
                    bill_member_id=member.id,
                    share_type="equal",
                    share_value=Decimal("0"),
                    amount_owed=Decimal("0"),
                )
                db.add(assignment)
                db.flush()
                affected_item_ids.add(str(item.id))
                deltas.append(("added", str(item.id), str(assignment.id)))

        elif claim.action == "unclaim":
            existing = (
                db.query(ItemAssignment)
                .filter(
                    ItemAssignment.receipt_item_id == item.id,
                    ItemAssignment.bill_member_id == member.id,
                )
                .first()
            )
            if existing:
                existing_id = str(existing.id)
                db.delete(existing)
                db.flush()
                affected_item_ids.add(str(item.id))
                deltas.append(("removed", str(item.id), existing_id))

    for item_id in affected_item_ids:
        item = db.query(ReceiptItem).filter(ReceiptItem.id == item_id).first()
        if item:
            _recalculate_equal_splits_for_item(db, item)

    db.commit()

    # Load post-commit authoritative per-item state so every delta carries
    # the recomputed equal-split amounts for siblings — receivers can
    # reconcile subtotals + per-member totals without a separate refetch.
    item_assignments_map = _load_item_assignments(db, affected_item_ids)

    # Emit compact deltas — other guests apply these in place without a full
    # `/party/:token/receipt` round-trip. The originating client's
    # `client_mutation_id` is echoed back so it suppresses its own event
    # (it already has the server response in hand from this HTTP reply).
    for action, item_id, assignment_id in deltas:
        payload: dict = {
            "action": action,
            "receipt_item_id": item_id,
            "bill_member_id": member_id_str,
            "assignment_id": assignment_id,
            "item_assignments": item_assignments_map.get(item_id, []),
        }
        if body.client_mutation_id is not None:
            payload["client_mutation_id"] = body.client_mutation_id
        _broadcast_delta_now(bill_id_str, payload)

    members = (
        db.query(BillMember)
        .filter(
            BillMember.bill_id == bill.id,
            BillMember.status != "invite_link",
        )
        .all()
    )
    return success_response(
        data=_build_receipt_response(db, bill, members),
        message="Items updated",
    )


@router.post("/{token}/confirm")
def confirm_and_pay(token: str, db: Session = Depends(get_db)):
    member = _get_member_by_token(db, token)
    if not member:
        return error_response("NOT_FOUND", "Invalid or expired invite link.", 404)

    if member.status != "joined":
        return error_response("BAD_REQUEST", "You must join the bill first.", 400)

    bill = member.bill
    if not bill:
        return error_response("NOT_FOUND", "Bill not found.", 404)

    try:
        assert_guest_payment_allowed(bill)
    except ValueError:
        return error_response(
            "PAYMENTS_LOCKED",
            "The host has not opened payments yet. Check back when they finish splitting the bill.",
            403,
        )

    calc_svc = CalculationService(db)
    breakdown = calc_svc.get_balance_breakdown(str(bill.id))

    member_breakdown = None
    for mb in breakdown["members"]:
        if mb["member_id"] == str(member.id):
            member_breakdown = mb
            break

    if not member_breakdown:
        return error_response("NOT_FOUND", "Member balance not found.", 404)

    total_owed = member_breakdown["remaining"]
    if total_owed <= 0:
        return error_response("BAD_REQUEST", "Nothing to pay.", 400)

    currency = (bill.currency or "USD").upper()
    min_amounts = {
        "USD": Decimal("0.50"), "EUR": Decimal("0.50"),
        "GBP": Decimal("0.30"), "CAD": Decimal("0.50"), "AUD": Decimal("0.50"),
    }
    min_amt = min_amounts.get(currency, Decimal("0.50"))
    if total_owed < min_amt:
        return error_response(
            "BAD_REQUEST",
            f"Amount {total_owed} {currency} is below the minimum charge of {min_amt} {currency}.",
            400,
        )

    pay_svc = PaymentService(db)
    try:
        payment = pay_svc.create_payment_intent(
            bill_id=str(bill.id),
            member_id=str(member.id),
            user_id=None,
            amount=total_owed,
            currency=currency,
        )
    except ValueError as e:
        return error_response("PAYMENT_ERROR", str(e), 400)

    # Line items for this guest (same shape as GET /pay/{token}) so web ReceiptCard
    # can list shares; breakdown subtotal already reflects these assignments.
    assignments = (
        db.query(ItemAssignment)
        .join(ReceiptItem, ItemAssignment.receipt_item_id == ReceiptItem.id)
        .filter(ItemAssignment.bill_member_id == member.id)
        .all()
    )
    items_out = []
    for assignment in assignments:
        item = assignment.item
        if not item:
            continue
        items_out.append({
            "name": item.name,
            "quantity": item.quantity,
            "unit_price": str(item.unit_price),
            "total_price": str(item.total_price),
            "assigned_amount": str(assignment.amount_owed),
            "share_type": assignment.share_type,
        })

    return success_response(data={
        "payment_id": str(payment.id),
        "amount": str(payment.amount),
        "currency": payment.currency,
        "stripe_client_secret": payment.stripe_client_secret,
        "stripe_publishable_key": settings.STRIPE_PUBLISHABLE_KEY,
        "items": items_out,
        "breakdown": {
            "subtotal": str(member_breakdown["subtotal"]),
            "tax_share": str(member_breakdown["tax_share"]),
            "tip_share": str(member_breakdown["tip_share"]),
            "fee_share": str(member_breakdown["fee_share"]),
            "total_owed": str(total_owed),
        },
    })


@router.post("/{token}/payment-complete")
def payment_complete(
    token: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    member = _get_member_by_token(db, token)
    if not member:
        return error_response("NOT_FOUND", "Invalid or expired invite link.", 404)

    from app.models.payment import Payment

    payment = (
        db.query(Payment)
        .filter(
            Payment.bill_member_id == member.id,
            Payment.status == "pending",
        )
        .order_by(Payment.created_at.desc())
        .first()
    )
    if not payment:
        return error_response("NOT_FOUND", "No pending payment found.", 404)

    if settings.STRIPE_SECRET_KEY and payment.stripe_payment_intent_id:
        import stripe
        stripe.api_key = settings.STRIPE_SECRET_KEY
        try:
            pi = stripe.PaymentIntent.retrieve(payment.stripe_payment_intent_id)
            if pi.status != "succeeded":
                return error_response(
                    "PAYMENT_NOT_CONFIRMED",
                    f"Stripe payment status is '{pi.status}', not 'succeeded'.",
                    400,
                )
        except Exception as e:
            logger.error("Stripe verification failed: %s", e)
            return error_response("PAYMENT_ERROR", "Could not verify payment with Stripe.", 500)

    pay_svc = PaymentService(db)
    pay_svc.confirm_payment(str(payment.id))

    bill_id_str = str(member.bill_id)
    background_tasks.add_task(
        _broadcast_event,
        bill_id_str,
        "payment_complete",
        {"member_id": str(member.id), "nickname": member.nickname},
    )

    return success_response(data={
        "payment_id": str(payment.id),
        "status": "succeeded",
    }, message="Payment confirmed")


# ── WebSocket ────────────────────────────────────────────────────

@router.websocket("/{token}/ws")
async def party_websocket(token: str, websocket: WebSocket):
    db = SessionLocal()
    try:
        member = _get_member_by_token(db, token)
        if not member:
            await websocket.close(code=4001, reason="Invalid token")
            return
        bill_id = str(member.bill_id)
    finally:
        db.close()

    await bill_ws_manager.connect(bill_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        bill_ws_manager.disconnect(bill_id, websocket)
