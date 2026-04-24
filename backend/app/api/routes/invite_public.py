"""Public invite link resolution (no auth). Token is opaque; never expose internal UUIDs."""

import logging

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.response import error_response, success_response
from app.db.session import get_db
from app.services.bill_service import BillService

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Public invites"])


@router.get("/invite/{token}/page", include_in_schema=False)
def serve_invite_page(token: str):
    """Serve the web invite page HTML for browser users."""
    return FileResponse("static/invite.html")


@router.get("/invite/{token}")
def get_public_invite(token: str, db: Session = Depends(get_db)):
    """Resolve an invite link. Returns bill details so the invitee knows what they're joining."""
    svc = BillService(db)
    member = svc.get_member_by_invite_token(token)
    if not member:
        return error_response("NOT_FOUND", "Invalid or expired invite link.", 404)

    bill = member.bill
    if not bill:
        return error_response("NOT_FOUND", "Bill not found.", 404)

    owner = bill.owner
    owner_name = owner.full_name if owner else "Someone"
    real_members = [m for m in (bill.members or []) if m.status != "invite_link"]
    member_count = len(real_members)

    return success_response(
        data={
            "bill_id": str(bill.id),
            "title": bill.title,
            "merchant_name": bill.merchant_name,
            "owner_name": owner_name,
            "member_count": member_count,
            "currency": bill.currency or "USD",
            "total": str(bill.total) if bill.total else "0.00",
            "member_nickname": member.nickname,
            "member_status": member.status,
            "deep_link": f"wealthsplit://invite?token={token}",
        }
    )
