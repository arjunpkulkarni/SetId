from sqlalchemy.orm import Session

from app.models.notification import Notification


class NotificationService:
    def __init__(self, db: Session):
        self.db = db

    def create(
        self,
        user_id: str,
        type: str,
        title: str,
        message: str,
        data: dict | None = None,
    ) -> Notification:
        notification = Notification(
            user_id=user_id,
            type=type,
            title=title,
            message=message,
            data=data,
        )
        self.db.add(notification)
        self.db.commit()
        self.db.refresh(notification)
        return notification

    def get_user_notifications(
        self, user_id: str, unread_only: bool = False
    ) -> list[Notification]:
        query = (
            self.db.query(Notification)
            .filter(Notification.user_id == user_id)
        )

        if unread_only:
            query = query.filter(Notification.read == False)  # noqa: E712

        return query.order_by(Notification.created_at.desc()).all()

    def mark_read(self, notification_id: str) -> Notification:
        notification = (
            self.db.query(Notification)
            .filter(Notification.id == notification_id)
            .first()
        )
        if not notification:
            raise ValueError(f"Notification {notification_id} not found")

        notification.read = True
        self.db.commit()
        self.db.refresh(notification)
        return notification
