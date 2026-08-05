"""
Models for Notifications app.
"""

from django.conf import settings
from django.db import models


class NotificationType(models.TextChoices):
    """Types of notifications."""

    NEW_MESSAGE = "new_message", "Ny besked"
    MESSAGE_REACTION = "message_reaction", "Reaktion på din besked"
    NEW_ANNOUNCEMENT = "new_announcement", "Ny vigtig post"
    ANNOUNCEMENT_UPDATED = "announcement_updated", "Vigtig post opdateret"
    NEW_THREAD = "new_thread", "Ny tråd i gruppen"
    THREAD_REPLY = "thread_reply", "Nyt svar i tråden"
    POST_REPLY = "post_reply", "Nyt svar på dit opslag"
    SUBGROUP_ACTIVITY = "subgroup_activity", "Ny aktivitet i gruppen"
    POST_REACTION = "post_reaction", "Reaktion på dit opslag"
    EVENT_CREATED = "event_created", "Ny begivenhed"
    EVENT_UPDATED = "event_updated", "Begivenhed opdateret"
    EVENT_CANCELLED = "event_cancelled", "Begivenhed aflyst"
    EVENT_REMINDER = "event_reminder", "Begivenhedsreminder"
    FOOD_TICKET = "food_ticket", "Madbillet tilgængelig"
    MENTION = "mention", "Omtale"
    SUBGROUP_MEMBER_ADDED = "subgroup_member_added", "Tilføjet som medlem"
    SUBGROUP_MEMBER_REMOVED = "subgroup_member_removed", "Fjernet som medlem"
    POST_EDITED_BY_ADMIN = "post_edited_by_admin", "Dit indhold blev redigeret af en administrator"
    EVENT_EDITED_BY_ADMIN = (
        "event_edited_by_admin",
        "Din begivenhed blev redigeret af en administrator",
    )
    ANNOUNCEMENT_EDITED_BY_ADMIN = (
        "announcement_edited_by_admin",
        "Dit opslag blev redigeret af en administrator",
    )
    EXPENSE_PROCESSED = "expense_processed", "Udlæg behandlet"
    CAR_LOAN_REQUEST = "car_loan_request", "Forespørgsel om at låne din bil"
    CAR_LOAN_UPDATE = "car_loan_update", "Opdatering om bildeling"


class Notification(models.Model):
    """User notification."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    notification_type = models.CharField(
        max_length=50,
        choices=NotificationType.choices,
    )
    title = models.CharField(max_length=255)
    message = models.TextField()
    link = models.CharField(max_length=500, blank=True)
    is_read = models.BooleanField(default=False)
    aggregate_count = models.IntegerField(default=1)
    group_key = models.CharField(max_length=500, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # Optional references to related objects
    related_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="triggered_notifications",
    )

    class Meta:
        ordering = ["-updated_at"]
        indexes = [
            # NotificationListView orders user's notifications by -created_at.
            models.Index(fields=["user", "-created_at"], name="notif_user_recent_idx"),
            # UnreadNotificationCountView is polled frequently and only cares
            # about the unread rows — a partial index keeps the count an
            # index-only seek even as the read backlog grows.
            models.Index(
                fields=["user"],
                condition=models.Q(is_read=False),
                name="notif_user_unread_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user.first_name}: {self.title}"


class NotificationPreference(models.Model):
    """User preferences for notifications."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notification_preferences",
    )

    # In-app notification preferences.
    # Note: NEW_MESSAGE never creates an in-app row (the unread-message count handles it), so
    # there is no in-app "new message" preference — only message *reactions* need a toggle.
    notify_message_reactions = models.BooleanField(default=True)
    notify_announcements = models.BooleanField(default=True)
    notify_announcement_updates = models.BooleanField(default=False)
    notify_forum_subscriptions = models.BooleanField(default=True)
    notify_thread_replies = models.BooleanField(default=True)
    notify_subgroup_activity = models.BooleanField(default=False)
    notify_post_reactions = models.BooleanField(default=True)
    notify_events = models.BooleanField(default=True)
    notify_event_reminders = models.BooleanField(default=True)
    notify_food_tickets = models.BooleanField(default=True)
    notify_mentions = models.BooleanField(default=True)
    notify_car_sharing = models.BooleanField(default=True)

    # Email notification preferences (per notification type)
    email_messages = models.BooleanField(default=False)
    email_announcements = models.BooleanField(default=False)
    email_announcement_updates = models.BooleanField(default=False)
    email_forum_subscriptions = models.BooleanField(default=False)
    email_thread_replies = models.BooleanField(default=False)
    email_subgroup_activity = models.BooleanField(default=False)
    email_post_reactions = models.BooleanField(default=False)
    email_events = models.BooleanField(default=False)
    email_event_reminders = models.BooleanField(default=False)
    email_food_tickets = models.BooleanField(default=False)
    email_mentions = models.BooleanField(default=False)
    email_car_sharing = models.BooleanField(default=False)

    # Push notification preferences (per notification type)
    push_messages = models.BooleanField(default=True)
    push_announcements = models.BooleanField(default=True)
    push_announcement_updates = models.BooleanField(default=False)
    push_forum_subscriptions = models.BooleanField(default=True)
    push_thread_replies = models.BooleanField(default=True)
    push_subgroup_activity = models.BooleanField(default=False)
    push_post_reactions = models.BooleanField(default=True)
    push_events = models.BooleanField(default=True)
    push_event_reminders = models.BooleanField(default=True)
    push_food_tickets = models.BooleanField(default=True)
    push_mentions = models.BooleanField(default=True)
    push_car_sharing = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"Notification preferences for {self.user.first_name}"


class PushSubscription(models.Model):
    """Web Push subscription for a user's browser/device."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="push_subscriptions",
    )
    endpoint = models.TextField(unique=True)
    p256dh_key = models.CharField(max_length=255)
    auth_key = models.CharField(max_length=255)

    # User agent for identifying device (optional)
    user_agent = models.CharField(max_length=500, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Push Subscription"
        verbose_name_plural = "Push Subscriptions"

    def __str__(self) -> str:
        return f"Push subscription for {self.user.first_name} ({self.endpoint[:50]}...)"

    def get_subscription_info(self) -> dict:
        """Return subscription info dict for pywebpush."""
        return {
            "endpoint": self.endpoint,
            "keys": {
                "p256dh": self.p256dh_key,
                "auth": self.auth_key,
            },
        }
