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
        results = data if isinstance(data, list) else data.get("results", data)
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

    def test_mark_specific_notifications_read(self, authenticated_client, multiple_notifications):
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


class TestMarkNotificationsByLinkView:
    """Tests for MarkNotificationsByLinkView — marks notifications read by their link URL."""

    def test_basic_ascii_link(self, authenticated_client, db, user):
        """Notification with a plain ASCII link is marked read."""
        notif = Notification.objects.create(
            user=user,
            notification_type=NotificationType.THREAD_REPLY,
            title="Reply",
            message="Someone replied",
            link="/forum/general/traad/some-thread",
        )
        response = authenticated_client.post(
            "/api/notifications/mark-read-by-link/",
            {"link": "/forum/general/traad/some-thread"},
            format="json",
        )
        assert response.status_code == 200
        assert response.json()["marked_read"] == 1
        notif.refresh_from_db()
        assert notif.is_read

    def test_url_encoded_unicode_slug(self, authenticated_client, db, user):
        """Percent-encoded path (as sent by browsers) matches notification stored with decoded Unicode.

        Thread slugs can contain Danish characters (æ, ø, å). Links are stored decoded in the DB,
        but browsers send location.pathname percent-encoded (e.g. æ → %C3%A6). The view must
        URL-decode the incoming link before matching.
        """
        notif = Notification.objects.create(
            user=user,
            notification_type=NotificationType.THREAD_REPLY,
            title="Reply",
            message="Someone replied",
            link="/forum/bugs/traad/notifikationer-bliver-hængende",  # stored decoded
        )
        # Browser (and React Router location.pathname) sends the percent-encoded form
        response = authenticated_client.post(
            "/api/notifications/mark-read-by-link/",
            {"link": "/forum/bugs/traad/notifikationer-bliver-h%C3%A6ngende"},
            format="json",
        )
        assert response.status_code == 200
        assert response.json()["marked_read"] == 1
        notif.refresh_from_db()
        assert notif.is_read

    def test_decoded_unicode_slug(self, authenticated_client, db, user):
        """Decoded Unicode path also matches (e.g. when sent directly)."""
        notif = Notification.objects.create(
            user=user,
            notification_type=NotificationType.THREAD_REPLY,
            title="Reply",
            message="Someone replied",
            link="/forum/bugs/traad/notifikationer-bliver-hængende",
        )
        response = authenticated_client.post(
            "/api/notifications/mark-read-by-link/",
            {"link": "/forum/bugs/traad/notifikationer-bliver-hængende"},
            format="json",
        )
        assert response.status_code == 200
        assert response.json()["marked_read"] == 1
        notif.refresh_from_db()
        assert notif.is_read

    def test_stored_link_with_hash_fragment(self, authenticated_client, db, user):
        """Stored link containing a #post-N hash is matched by the bare path (no hash)."""
        notif = Notification.objects.create(
            user=user,
            notification_type=NotificationType.THREAD_REPLY,
            title="Reply",
            message="Someone replied",
            link="/forum/general/traad/some-thread#post-42",
        )
        response = authenticated_client.post(
            "/api/notifications/mark-read-by-link/",
            {"link": "/forum/general/traad/some-thread"},
            format="json",
        )
        assert response.status_code == 200
        assert response.json()["marked_read"] == 1
        notif.refresh_from_db()
        assert notif.is_read

    def test_encoded_unicode_with_hash(self, authenticated_client, db, user):
        """Percent-encoded path matches stored link that has both a Unicode slug and a hash."""
        notif = Notification.objects.create(
            user=user,
            notification_type=NotificationType.THREAD_REPLY,
            title="Reply",
            message="Someone replied",
            link="/forum/bugs/traad/notifikationer-bliver-hængende#post-42",
        )
        response = authenticated_client.post(
            "/api/notifications/mark-read-by-link/",
            {"link": "/forum/bugs/traad/notifikationer-bliver-h%C3%A6ngende"},
            format="json",
        )
        assert response.status_code == 200
        assert response.json()["marked_read"] == 1
        notif.refresh_from_db()
        assert notif.is_read

    def test_already_read_not_counted(self, authenticated_client, db, user):
        """Notifications that are already read are not double-counted."""
        Notification.objects.create(
            user=user,
            notification_type=NotificationType.THREAD_REPLY,
            title="Old",
            message="Already read",
            link="/forum/general/traad/some-thread",
            is_read=True,
        )
        response = authenticated_client.post(
            "/api/notifications/mark-read-by-link/",
            {"link": "/forum/general/traad/some-thread"},
            format="json",
        )
        assert response.status_code == 200
        assert response.json()["marked_read"] == 0

    def test_cannot_mark_other_users_notifications(self, authenticated_client, db, second_user):
        """A user cannot mark another user's notifications as read."""
        notif = Notification.objects.create(
            user=second_user,
            notification_type=NotificationType.THREAD_REPLY,
            title="Reply",
            message="Other user's notification",
            link="/forum/general/traad/some-thread",
        )
        response = authenticated_client.post(
            "/api/notifications/mark-read-by-link/",
            {"link": "/forum/general/traad/some-thread"},
            format="json",
        )
        assert response.status_code == 200
        assert response.json()["marked_read"] == 0
        notif.refresh_from_db()
        assert not notif.is_read

    def test_empty_link_returns_zero(self, authenticated_client):
        """Empty link returns zero without touching the database."""
        response = authenticated_client.post(
            "/api/notifications/mark-read-by-link/",
            {"link": ""},
            format="json",
        )
        assert response.status_code == 200
        assert response.json()["marked_read"] == 0

    def test_marks_multiple_notifications_for_same_link(self, authenticated_client, db, user):
        """Multiple unread notifications pointing to the same link are all marked read."""
        for i in range(3):
            Notification.objects.create(
                user=user,
                notification_type=NotificationType.THREAD_REPLY,
                title=f"Reply {i}",
                message="Someone replied",
                link="/forum/general/traad/busy-thread",
            )
        response = authenticated_client.post(
            "/api/notifications/mark-read-by-link/",
            {"link": "/forum/general/traad/busy-thread"},
            format="json",
        )
        assert response.status_code == 200
        assert response.json()["marked_read"] == 3


class TestClearAllNotificationsAPI:
    """Tests for the Clear All Notifications API endpoint."""

    def test_clear_all_notifications(self, authenticated_client, multiple_notifications):
        """Test clearing all notifications."""
        response = authenticated_client.delete("/api/notifications/clear-all/")
        assert response.status_code == 200
        assert response.json()["deleted"] == 5

        # Verify all are deleted
        assert Notification.objects.count() == 0
