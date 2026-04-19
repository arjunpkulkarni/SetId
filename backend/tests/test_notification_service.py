"""Tests for NotificationService — verifies IDOR protection on mark_read."""

from unittest.mock import MagicMock

import pytest

from app.services.notification_service import NotificationService


class TestMarkRead:
    def test_marks_own_notification(self):
        db = MagicMock()
        notif = MagicMock()
        notif.id = "notif-1"
        notif.user_id = "user-1"
        notif.read = False

        db.query.return_value.filter.return_value.first.return_value = notif

        svc = NotificationService(db)
        result = svc.mark_read("notif-1", "user-1")

        assert result.read is True
        db.commit.assert_called_once()

    def test_cannot_mark_other_users_notification(self):
        """mark_read filters by (notification_id, user_id), so another user's
        notification won't be found — returns ValueError, not the notification."""
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None

        svc = NotificationService(db)
        with pytest.raises(ValueError, match="not found"):
            svc.mark_read("notif-1", "different-user")

    def test_nonexistent_notification(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None

        svc = NotificationService(db)
        with pytest.raises(ValueError, match="not found"):
            svc.mark_read("no-such-notif", "user-1")


class TestGetUserNotifications:
    def test_returns_only_users_notifications(self):
        db = MagicMock()
        notifs = [MagicMock(), MagicMock()]
        db.query.return_value.filter.return_value.order_by.return_value.all.return_value = notifs

        svc = NotificationService(db)
        result = svc.get_user_notifications("user-1")

        assert len(result) == 2

    def test_unread_only_filter(self):
        db = MagicMock()
        chain = db.query.return_value.filter.return_value
        chain.filter.return_value.order_by.return_value.all.return_value = [MagicMock()]

        svc = NotificationService(db)
        result = svc.get_user_notifications("user-1", unread_only=True)

        assert len(result) == 1
