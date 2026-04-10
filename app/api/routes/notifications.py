import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.core.response import success_response, error_response
from app.schemas.notification import NotificationOut
from app.services.notification_service import NotificationService

router = APIRouter(prefix="/notifications", tags=["Notifications"])


@router.get("")
def list_notifications(
    unread_only: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = NotificationService(db)
    notifications = svc.get_user_notifications(
        user_id=str(current_user.id),
        unread_only=unread_only,
    )
    notifications_data = [
        NotificationOut.model_validate(n).model_dump() for n in notifications
    ]
    return success_response(data=notifications_data)


@router.patch("/{notification_id}/read")
def mark_notification_read(
    notification_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = NotificationService(db)
    try:
        notification = svc.mark_read(str(notification_id))
    except ValueError:
        return error_response("NOT_FOUND", "Notification not found", 404)

    return success_response(
        data=NotificationOut.model_validate(notification).model_dump(),
        message="Notification marked as read",
    )
