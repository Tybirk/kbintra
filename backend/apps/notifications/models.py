"""
Models for Notifications app.
"""

from django.conf import settings
from django.db import models


class NotificationType(models.TextChoices):
    """Types of notifications."""

    NEW_MESSAGE = "new_message", "New Message"
    NEW_ANNOUNCEMENT = "new_announcement", "New Announcement"
    NEW_THREAD = "new_thread", "New Thread in Subscribed Subgroup"
    THREAD_REPLY = "thread_reply", "Reply to Your Thread"
    POST_REPLY = "post_reply", "Reply to Your Post"
    POST_REACTION = "post_reaction", "Reaction to Your Post"
    EVENT_REMINDER = "event_reminder", "Event Reminder"
    FOOD_TICKET = "food_ticket", "Food Ticket Available"


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
    created_at = models.DateTimeField(auto_now_add=True)

    # Optional references to related objects
    related_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="triggered_notifications",
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.user.first_name}: {self.title}"


class NotificationPreference(models.Model):
    """User preferences for notifications."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notification_preferences",
    )

    # In-app notification preferences
    notify_messages = models.BooleanField(default=True)
    notify_announcements = models.BooleanField(default=True)
    notify_forum_subscriptions = models.BooleanField(default=True)
    notify_thread_replies = models.BooleanField(default=True)
    notify_post_reactions = models.BooleanField(default=True)
    notify_event_reminders = models.BooleanField(default=True)
    notify_food_tickets = models.BooleanField(default=True)

    # Email notification preferences (per notification type)
    email_messages = models.BooleanField(default=False)
    email_announcements = models.BooleanField(default=False)
    email_forum_subscriptions = models.BooleanField(default=False)
    email_thread_replies = models.BooleanField(default=False)
    email_post_reactions = models.BooleanField(default=False)
    email_event_reminders = models.BooleanField(default=False)
    email_food_tickets = models.BooleanField(default=False)

    # Push notification preferences (per notification type)
    push_messages = models.BooleanField(default=True)
    push_announcements = models.BooleanField(default=True)
    push_forum_subscriptions = models.BooleanField(default=True)
    push_thread_replies = models.BooleanField(default=True)
    push_post_reactions = models.BooleanField(default=True)
    push_event_reminders = models.BooleanField(default=True)
    push_food_tickets = models.BooleanField(default=True)

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
