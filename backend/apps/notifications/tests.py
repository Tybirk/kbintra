"""
Tests for the Notifications app.
"""

from unittest.mock import MagicMock, patch

import pytest

from apps.notifications.models import (
    Notification,
    NotificationPreference,
    NotificationType,
    PushSubscription,
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


class TestPushRetryClassification:
    """Tests for the push retry classification logic.

    Transient failures (network errors, 5xx, 429, unknown status) must raise
    TransientPushError so Huey retries with backoff. Permanent failures
    (401/403 auth, expired 404/410, other 4xx) must NOT raise.
    """

    @pytest.fixture
    def push_subscription(self, db, user):
        return PushSubscription.objects.create(
            user=user,
            endpoint="https://fcm.googleapis.com/fcm/send/test-endpoint",
            p256dh_key="test-p256dh",
            auth_key="test-auth",
        )

    @pytest.fixture(autouse=True)
    def vapid_settings(self, settings):
        settings.VAPID_PRIVATE_KEY = "test-key"
        settings.VAPID_CLAIMS = {"sub": "mailto:test@example.com"}

    def _make_webpush_exception(self, status_code: int | None):
        from pywebpush import WebPushException

        exc = WebPushException(f"Push failed: {status_code}" if status_code else "Push failed")
        if status_code is not None:
            exc.response = MagicMock(status_code=status_code)
        return exc

    @pytest.mark.parametrize("status_code", [500, 502, 503, 429])
    def test_5xx_and_429_raise_transient(self, push_subscription, status_code):
        from apps.notifications.services import TransientPushError, send_push_to_subscription

        with (
            patch("pywebpush.webpush", side_effect=self._make_webpush_exception(status_code)),
            pytest.raises(TransientPushError),
        ):
            send_push_to_subscription(
                subscription=push_subscription,
                notification_type="new_message",
                title="t",
                message="m",
                link="/x",
            )
        # Subscription must NOT be deleted on transient errors.
        assert PushSubscription.objects.filter(id=push_subscription.id).exists()

    def test_network_error_raises_transient(self, push_subscription):
        from apps.notifications.services import TransientPushError, send_push_to_subscription

        with (
            patch("pywebpush.webpush", side_effect=ConnectionError("Network unreachable")),
            pytest.raises(TransientPushError),
        ):
            send_push_to_subscription(
                subscription=push_subscription,
                notification_type="new_message",
                title="t",
                message="m",
                link="/x",
            )
        assert PushSubscription.objects.filter(id=push_subscription.id).exists()

    @pytest.mark.parametrize("status_code", [404, 410])
    def test_expired_does_not_raise_and_deletes_subscription(self, push_subscription, status_code):
        from apps.notifications.services import send_push_to_subscription

        with patch("pywebpush.webpush", side_effect=self._make_webpush_exception(status_code)):
            send_push_to_subscription(
                subscription=push_subscription,
                notification_type="new_message",
                title="t",
                message="m",
                link="/x",
            )
        # Expired subscription must be deleted.
        assert not PushSubscription.objects.filter(id=push_subscription.id).exists()

    @pytest.mark.parametrize("status_code", [401, 403])
    def test_auth_failure_does_not_raise_and_keeps_subscription(
        self, push_subscription, status_code
    ):
        from apps.notifications.services import send_push_to_subscription

        with patch("pywebpush.webpush", side_effect=self._make_webpush_exception(status_code)):
            send_push_to_subscription(
                subscription=push_subscription,
                notification_type="new_message",
                title="t",
                message="m",
                link="/x",
            )
        # Bad VAPID config — keep the subscription, retrying won't help.
        assert PushSubscription.objects.filter(id=push_subscription.id).exists()

    def test_400_does_not_raise(self, push_subscription):
        from apps.notifications.services import send_push_to_subscription

        with patch("pywebpush.webpush", side_effect=self._make_webpush_exception(400)):
            send_push_to_subscription(
                subscription=push_subscription,
                notification_type="new_message",
                title="t",
                message="m",
                link="/x",
            )
        assert PushSubscription.objects.filter(id=push_subscription.id).exists()

    def test_success_does_not_raise(self, push_subscription):
        from apps.notifications.services import send_push_to_subscription

        with patch("pywebpush.webpush", return_value=MagicMock(status_code=201)):
            send_push_to_subscription(
                subscription=push_subscription,
                notification_type="new_message",
                title="t",
                message="m",
                link="/x",
            )
        assert PushSubscription.objects.filter(id=push_subscription.id).exists()


class TestPushExponentialBackoff:
    """Verify the per-attempt backoff schedule used by send_push_to_subscription_task."""

    def test_backoff_sequence(self):
        from itertools import pairwise

        from apps.notifications.tasks import (
            PUSH_MAX_ATTEMPTS,
            PUSH_RETRY_DELAYS,
        )

        # 5 total attempts = 1 initial + 4 retries; backoff ramps 60 → 480.
        assert PUSH_MAX_ATTEMPTS == 5
        assert PUSH_RETRY_DELAYS == [60, 120, 240, 480]
        # Strictly increasing (true exponential backoff).
        for prev, nxt in pairwise(PUSH_RETRY_DELAYS):
            assert nxt > prev


class TestPushDeliveryErrorOnExhaustion:
    """The final exhausted-retry exception must be PushDeliveryError (not filtered by Sentry)."""

    @pytest.fixture
    def push_subscription(self, db, user):
        return PushSubscription.objects.create(
            user=user,
            endpoint="https://fcm.googleapis.com/fcm/send/test-endpoint",
            p256dh_key="test-p256dh",
            auth_key="test-auth",
        )

    @pytest.fixture(autouse=True)
    def vapid_settings(self, settings):
        settings.VAPID_PRIVATE_KEY = "test-key"
        settings.VAPID_CLAIMS = {"sub": "mailto:test@example.com"}

    def test_no_retries_remaining_raises_push_delivery_failed(self, push_subscription):
        """When task.retries is 0, escalate transient → PushDeliveryError."""
        from apps.notifications.tasks import (
            PushDeliveryError,
            send_push_to_subscription_task,
        )

        # Fake task context with no retries remaining (final attempt).
        fake_task = MagicMock(retries=0, retry_delay=60)

        with (
            patch("pywebpush.webpush", side_effect=ConnectionError("Network unreachable")),
            pytest.raises(PushDeliveryError),
        ):
            # Call the underlying function directly (Huey decorators wrap .call_local)
            send_push_to_subscription_task.call_local(
                push_subscription.id,
                "new_message",
                "t",
                "m",
                "/x",
                task=fake_task,
            )

    def test_retries_remaining_raises_transient(self, push_subscription):
        """When retries remain, raise TransientPushError so Huey reschedules."""
        from apps.notifications.services import TransientPushError
        from apps.notifications.tasks import send_push_to_subscription_task

        fake_task = MagicMock(retries=3, retry_delay=60)

        with (
            patch("pywebpush.webpush", side_effect=ConnectionError("Network unreachable")),
            pytest.raises(TransientPushError),
        ):
            send_push_to_subscription_task.call_local(
                push_subscription.id,
                "new_message",
                "t",
                "m",
                "/x",
                task=fake_task,
            )


class TestClearAllNotificationsAPI:
    """Tests for the Clear All Notifications API endpoint."""

    def test_clear_all_notifications(self, authenticated_client, multiple_notifications):
        """Test clearing all notifications."""
        response = authenticated_client.delete("/api/notifications/clear-all/")
        assert response.status_code == 200
        assert response.json()["deleted"] == 5

        # Verify all are deleted
        assert Notification.objects.count() == 0


class TestMessageReactionInAppPreference:
    """In-app message reactions are gated by the dedicated notify_message_reactions field.

    NEW_MESSAGE never creates an in-app row, so this field is the only in-app control for
    message reactions — and it now has a UI toggle (it previously rode on notify_messages,
    which had no in-app switch, so users could not turn message reactions off in-app).
    """

    @pytest.mark.django_db
    def test_message_reaction_in_app_suppressed_when_disabled(self, user, second_user):
        from apps.notifications.services import notify_message_reaction

        NotificationPreference.objects.create(user=user, notify_message_reactions=False)
        notify_message_reaction(
            message_author=user,
            reactor=second_user,
            reaction_emoji="👍",
            conversation_id=1,
            message_id=1,
        )
        assert not Notification.objects.filter(
            user=user, notification_type=NotificationType.MESSAGE_REACTION
        ).exists()

    @pytest.mark.django_db
    def test_message_reaction_in_app_created_when_enabled(self, user, second_user):
        from apps.notifications.services import notify_message_reaction

        NotificationPreference.objects.create(user=user, notify_message_reactions=True)
        notify_message_reaction(
            message_author=user,
            reactor=second_user,
            reaction_emoji="👍",
            conversation_id=1,
            message_id=1,
        )
        assert Notification.objects.filter(
            user=user, notification_type=NotificationType.MESSAGE_REACTION
        ).exists()


class TestNotificationChannelDedup:
    """Per-channel de-duplication: one activity must give one notification per channel.

    The in-app preference only gates the in-app row; email and push are dispatched
    independently. When a user "falls through" from a higher-priority type (THREAD_REPLY,
    NEW_THREAD, MENTION) to the catch-all SUBGROUP_ACTIVITY in-app, the higher-priority type
    still goes out by email/push — so the fall-through SUBGROUP_ACTIVITY must suppress those
    channels to avoid a double.
    """

    @pytest.mark.django_db
    def test_superseded_by_skips_only_channels_higher_type_covers(
        self, user, second_user, django_capture_on_commit_callbacks
    ):
        # Higher type (THREAD_REPLY) is enabled on push but not email → superseding it skips
        # only push for the lower notification; email still goes out.
        from apps.notifications.services import create_notification

        NotificationPreference.objects.create(
            user=user,
            notify_post_reactions=True,
            email_post_reactions=True,
            push_post_reactions=True,
            email_thread_replies=False,
            push_thread_replies=True,
        )
        with (
            patch("apps.notifications.tasks.send_email_task") as email_task,
            patch("apps.notifications.tasks.send_push_task") as push_task,
            django_capture_on_commit_callbacks(execute=True),
        ):
            create_notification(
                user=user,
                notification_type=NotificationType.POST_REACTION,
                title="t",
                message="m",
                related_user=second_user,
                superseded_by=[NotificationType.THREAD_REPLY],
            )
        assert email_task.called
        assert not push_task.called

    @pytest.mark.django_db
    def test_superseded_by_skips_email_when_higher_type_covers_email(
        self, user, second_user, django_capture_on_commit_callbacks
    ):
        from apps.notifications.services import create_notification

        NotificationPreference.objects.create(
            user=user,
            notify_post_reactions=True,
            email_post_reactions=True,
            push_post_reactions=True,
            email_thread_replies=True,
            push_thread_replies=False,
        )
        with (
            patch("apps.notifications.tasks.send_email_task") as email_task,
            patch("apps.notifications.tasks.send_push_task") as push_task,
            django_capture_on_commit_callbacks(execute=True),
        ):
            create_notification(
                user=user,
                notification_type=NotificationType.POST_REACTION,
                title="t",
                message="m",
                related_user=second_user,
                superseded_by=[NotificationType.THREAD_REPLY],
            )
        assert not email_task.called
        assert push_task.called

    @pytest.mark.django_db
    def test_superseded_by_lower_priority_type_does_not_suppress(
        self, user, second_user, django_capture_on_commit_callbacks
    ):
        # A superseded_by entry that does NOT outrank the notification (per _FORUM_ACTIVITY_TIERS)
        # must never suppress a channel — guards against a mis-declared call site.
        from apps.notifications.services import create_notification

        NotificationPreference.objects.create(
            user=user,
            notify_thread_replies=True,
            email_thread_replies=True,
            push_thread_replies=True,
            email_subgroup_activity=True,
            push_subgroup_activity=True,
        )
        with (
            patch("apps.notifications.tasks.send_email_task") as email_task,
            patch("apps.notifications.tasks.send_push_task") as push_task,
            django_capture_on_commit_callbacks(execute=True),
        ):
            create_notification(
                user=user,
                notification_type=NotificationType.THREAD_REPLY,
                title="t",
                message="m",
                related_user=second_user,
                # SUBGROUP_ACTIVITY ranks below THREAD_REPLY, so it cannot supersede it.
                superseded_by=[NotificationType.SUBGROUP_ACTIVITY],
            )
        assert email_task.called
        assert push_task.called

    @pytest.mark.django_db
    def test_thread_reply_fallthrough_suppresses_subgroup_activity_push(
        self, user, second_user, subgroup, django_capture_on_commit_callbacks
    ):
        from apps.forum.models import SubgroupSubscription, Thread
        from apps.notifications.tasks import notify_subgroup_activity_task

        # Participant turned OFF in-app thread replies, kept push on, and enabled subgroup
        # activity on both in-app and push.
        NotificationPreference.objects.create(
            user=user,
            notify_thread_replies=False,
            push_thread_replies=True,
            notify_subgroup_activity=True,
            push_subgroup_activity=True,
        )
        SubgroupSubscription.objects.create(user=user, subgroup=subgroup, notify_new_threads=True)
        thread = Thread.objects.create(subgroup=subgroup, title="T", author=user)

        with (
            patch("apps.notifications.tasks.send_push_task") as push_task,
            django_capture_on_commit_callbacks(execute=True),
        ):
            notify_subgroup_activity_task(
                replier_id=second_user.id,
                thread_title="T",
                thread_id=thread.id,
                subgroup_id=subgroup.id,
                subgroup_name=subgroup.name,
                subgroup_slug=subgroup.slug,
                thread_slug=thread.slug,
                reply_content="hello",
                post_id=123,
                participant_ids=[user.id],
                mentioned_ids=[],
            )

        # Fall-through still gives an in-app SUBGROUP_ACTIVITY row...
        assert Notification.objects.filter(
            user=user, notification_type=NotificationType.SUBGROUP_ACTIVITY
        ).exists()
        # ...but its push is suppressed (THREAD_REPLY push covers this activity).
        pushed = [c.args[1] for c in push_task.call_args_list if c.args and c.args[0] == user.id]
        assert NotificationType.SUBGROUP_ACTIVITY not in pushed

    @pytest.mark.django_db
    def test_new_thread_fallthrough_suppresses_subgroup_activity_push(
        self, user, second_user, subgroup, django_capture_on_commit_callbacks
    ):
        from apps.forum.models import SubgroupSubscription, Thread
        from apps.notifications.tasks import notify_subgroup_activity_new_thread_task

        # Subscriber turned OFF in-app new-thread notifications, kept push on, and enabled
        # subgroup activity on both in-app and push.
        NotificationPreference.objects.create(
            user=user,
            notify_forum_subscriptions=False,
            push_forum_subscriptions=True,
            notify_subgroup_activity=True,
            push_subgroup_activity=True,
        )
        SubgroupSubscription.objects.create(user=user, subgroup=subgroup, notify_new_threads=True)
        thread = Thread.objects.create(subgroup=subgroup, title="T", author=second_user)

        with (
            patch("apps.notifications.tasks.send_push_task") as push_task,
            django_capture_on_commit_callbacks(execute=True),
        ):
            notify_subgroup_activity_new_thread_task(
                author_id=second_user.id,
                thread_title="T",
                thread_id=thread.id,
                subgroup_id=subgroup.id,
                subgroup_name=subgroup.name,
                subgroup_slug=subgroup.slug,
                thread_slug=thread.slug,
                initial_post_content="hello",
                post_id=123,
                exclude_user_ids=[second_user.id],
            )

        assert Notification.objects.filter(
            user=user, notification_type=NotificationType.SUBGROUP_ACTIVITY
        ).exists()
        pushed = [c.args[1] for c in push_task.call_args_list if c.args and c.args[0] == user.id]
        assert NotificationType.SUBGROUP_ACTIVITY not in pushed

    @pytest.mark.django_db
    def test_subgroup_activity_gated_only_by_global_preference(
        self, user, second_user, subgroup, django_capture_on_commit_callbacks
    ):
        """Regression: a subgroup subscriber with the global notify_subgroup_activity
        preference ON receives SUBGROUP_ACTIVITY for a reply in a thread they don't
        participate in. (The former per-subgroup notify_replies flag, which silently
        suppressed this, has been removed.)"""
        from apps.forum.models import SubgroupSubscription, Thread
        from apps.notifications.tasks import notify_subgroup_activity_task

        NotificationPreference.objects.create(
            user=user,
            notify_subgroup_activity=True,
        )
        SubgroupSubscription.objects.create(user=user, subgroup=subgroup, notify_new_threads=True)
        thread = Thread.objects.create(subgroup=subgroup, title="T", author=second_user)

        with django_capture_on_commit_callbacks(execute=True):
            notify_subgroup_activity_task(
                replier_id=second_user.id,
                thread_title="T",
                thread_id=thread.id,
                subgroup_id=subgroup.id,
                subgroup_name=subgroup.name,
                subgroup_slug=subgroup.slug,
                thread_slug=thread.slug,
                reply_content="hello",
                post_id=123,
                participant_ids=[],
                mentioned_ids=[],
            )

        assert Notification.objects.filter(
            user=user, notification_type=NotificationType.SUBGROUP_ACTIVITY
        ).exists()
