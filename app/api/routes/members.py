import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.core.response import success_response, error_response
from app.schemas.bill_member import MemberAdd, MemberUpdate, BillMemberOut, InviteLinkOut
from app.services.bill_service import BillService

router = APIRouter(prefix="/bills/{bill_id}", tags=["Members"])


@router.post("/members", status_code=201)
def add_member(
    bill_id: uuid.UUID,
    body: MemberAdd,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = BillService(db)
    try:
        member = svc.add_member(
            bill_id=str(bill_id),
            user_id=str(body.user_id) if body.user_id else None,
            email=body.email if body.email else None,
            nickname=body.nickname,
        )
    except ValueError as e:
        return error_response("BAD_REQUEST", str(e), 400)

    return success_response(
        data=BillMemberOut.model_validate(member).model_dump(),
        message="Member added",
    )


@router.get("/members")
def list_members(
    bill_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = BillService(db)
    members = svc.get_members(str(bill_id))
    members_data = [BillMemberOut.model_validate(m).model_dump() for m in members]
    return success_response(data=members_data)


@router.patch("/members/{member_id}")
def update_member(
    bill_id: uuid.UUID,
    member_id: uuid.UUID,
    body: MemberUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = BillService(db)
    try:
        member = svc.update_member(
            str(member_id),
            body.model_dump(exclude_unset=True),
        )
    except ValueError:
        return error_response("NOT_FOUND", "Member not found", 404)

    return success_response(
        data=BillMemberOut.model_validate(member).model_dump(),
        message="Member updated",
    )


@router.delete("/members/{member_id}")
def remove_member(
    bill_id: uuid.UUID,
    member_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = BillService(db)
    try:
        svc.remove_member(str(member_id))
    except ValueError:
        return error_response("NOT_FOUND", "Member not found", 404)

    return success_response(message="Member removed")


@router.post("/invite-link")
def create_invite_link(
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
    return success_response(data=invite_data.model_dump(), message="Invite link created")
