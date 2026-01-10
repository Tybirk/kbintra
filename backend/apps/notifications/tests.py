"""
Tests for the Notifications app.
"""

import pytest

from apps.notifications.models import (
    Notification,
    NotificationPreference,
    NotificationType,
)


@pytest.fixture
def notification(db, user):
    """Create a test notification."""
    return Notification.objects.create(
        user=user,
        notification_type=NotificationType.NEW_THREAD,
        title="New Thread",
        message="Someone posted a new thread",
        link="/forum/test-thread",
    )


@pytest.fixture
def multiple_notifications(db, user):
    """Create multiple test notifications."""
    notifications = []
    for i in range(5):
        notifications.append(
            Notification.objects.create(
                user=user,
                notification_type=NotificationType.THREAD_REPLY,
                title=f"Notification {i}",
                message=f"Message {i}",
                is_read=(i < 2),  # First 2 are read
            )
        )
    return notifications


# =============================================================================
# Model Tests
# =============================================================================


class TestNotificationModel:
    """Tests for the Notification model."""

    def test_notification_str(self, notification):
        """Test string representation of notification."""
        assert "New Thread" in str(notification)

    def test_notification_ordering(self, multiple_notifications):
        """Test that notifications are ordered by created_at descending."""
        notifications = list(Notification.objects.all())
        # Most recent should be first
        assert notifications[0].title == "Notification 4"


class TestNotificationPreferenceModel:
    """Tests for the NotificationPreference model."""

    def test_preference_str(self, db, user):
        """Test string representation of preference."""
        pref = NotificationPreference.objects.create(user=user)
        assert user.first_name in str(pref)


# =============================================================================
# API Tests
# =============================================================================


class TestNotificationAPI:
    """Tests for the Notification API endpoints."""

    def test_list_notifications_unauthenticated(self, api_client):
        """Test that unauthenticated users cannot list notifications."""
        response = api_client.get("/api/notifications/")
        assert response.status_code == 401

    def test_list_notifications(self, authenticated_client, notification):
        """Test listing notifications."""
        response = authenticated_client.get("/api/notifications/")
        assert response.status_code == 200

        data = response.json()
        results = data.get("results", data)
        assert len(results) == 1
        assert results[0]["title"] == "New Thread"

    def test_get_notification(self, authenticated_client, notification):
        """Test getting a single notification."""
        response = authenticated_client.get(f"/api/notifications/{notification.id}/")
        assert response.status_code == 200
        assert response.json()["title"] == "New Thread"

    def test_delete_notification(self, authenticated_client, notification):
        """Test deleting a notification."""
        response = authenticated_client.delete(f"/api/notifications/{notification.id}/")
        assert response.status_code == 204
        assert not Notification.objects.filter(id=notification.id).exists()


class TestMarkNotificationsReadAPI:
    """Tests for the Mark Notifications Read API endpoint."""

    def test_mark_all_notifications_read(self, authenticated_client, multiple_notifications):
        """Test marking all notifications as read."""
        response = authenticated_client.post("/api/notifications/mark-read/", {})
        assert response.status_code == 200
        assert response.json()["marked_read"] == 3  # 3 were unread

        # Verify all are read
        assert Notification.objects.filter(is_read=False).count() == 0

    def test_mark_specific_notifications_read(
        self, authenticated_client, multiple_notifications
    ):
        """Test marking specific notifications as read."""
        ids_to_mark = [n.id for n in multiple_notifications[2:4]]
        response = authenticated_client.post(
            "/api/notifications/mark-read/",
            {"notification_ids": ids_to_mark},
            format="json",
        )
        assert response.status_code == 200
        assert response.json()["marked_read"] == 2


class TestUnreadNotificationCountAPI:
    """Tests for the Unread Notification Count API endpoint."""

    def test_unread_count(self, authenticated_client, multiple_notifications):
        """Test getting unread notification count."""
        response = authenticated_client.get("/api/notifications/unread-count/")
        assert response.status_code == 200
        assert response.json()["unread_count"] == 3


class TestNotificationPreferenceAPI:
    """Tests for the Notification Preference API endpoint."""

    def test_get_preferences(self, authenticated_client):
        """Test getting notification preferences."""
        response = authenticated_client.get("/api/notifications/preferences/")
        assert response.status_code == 200
        # Default values - email notifications are off by default
        assert response.json()["email_forum_subscriptions"] is False

    def test_update_preferences(self, authenticated_client):
        """Test updating notification preferences."""
        response = authenticated_client.patch(
            "/api/notifications/preferences/",
            {"email_forum_subscriptions": True},
            format="json",
        )
        assert response.status_code == 200
        assert response.json()["email_forum_subscriptions"] is True


class TestClearAllNotificationsAPI:
    """Tests for the Clear All Notifications API endpoint."""

    def test_clear_all_notifications(self, authenticated_client, multiple_notifications):
        """Test clearing all notifications."""
        response = authenticated_client.delete("/api/notifications/clear-all/")
        assert response.status_code == 200
        assert response.json()["deleted"] == 5

        # Verify all are deleted
        assert Notification.objects.count() == 0
