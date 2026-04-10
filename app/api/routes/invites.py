import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.core.response import success_response, error_response
from app.schemas.bill_member import BillMemberOut, InviteLinkOut
from app.services.bill_service import BillService


class JoinRequest(BaseModel):
    token: str


router = APIRouter(tags=["Invites"])


@router.post("/bills/{bill_id}/share")
def share_bill(
    bill_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = BillService(db)
    try:
        token, expires_at = svc.create_invite_token(str(bill_id))
    except ValueError:
        return error_response("NOT_FOUND", "Bill not found", 404)

    invite_data = InviteLinkOut(
        invite_url=f"http://localhost:3000/join/{token}",
        token=token,
        expires_at=expires_at,
    )
    return success_response(data=invite_data.model_dump(), message="Share link created")


@router.post("/bills/{bill_id}/join")
def join_bill(
    bill_id: uuid.UUID,
    body: JoinRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = BillService(db)
    try:
        member = svc.join_by_token(body.token, str(current_user.id))
    except ValueError as e:
        return error_response("INVALID_TOKEN", str(e), 400)

    return success_response(
        data=BillMemberOut.model_validate(member).model_dump(),
        message="Successfully joined the bill",
    )


@router.get("/invites/{token}")
def get_invite_info(
    token: str,
    db: Session = Depends(get_db),
):
    token_data = BillService._invite_tokens.get(token)
    if not token_data:
        return error_response("NOT_FOUND", "Invalid or expired invite token", 404)

    if datetime.now(timezone.utc) > token_data["expires_at"]:
        del BillService._invite_tokens[token]
        return error_response("EXPIRED", "Invite token has expired", 410)

    svc = BillService(db)
    bill = svc.get_bill(token_data["bill_id"])
    if not bill:
        return error_response("NOT_FOUND", "Bill not found", 404)

    return success_response(data={
        "bill_id": str(bill.id),
        "title": bill.title,
        "merchant_name": bill.merchant_name,
        "owner_id": str(bill.owner_id),
        "expires_at": token_data["expires_at"].isoformat(),
    })
