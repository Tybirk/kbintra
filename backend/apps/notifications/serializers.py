"""
Serializers for Notifications models.
"""

from rest_framework import serializers

from apps.users.models import User

from .models import Notification, NotificationPreference, NotificationType


class RelatedUserSerializer(serializers.ModelSerializer):
    """Minimal serializer for related user in notifications."""

    class Meta:
        model = User
        fields = ["id", "first_name", "last_name", "profile_picture"]


class NotificationSerializer(serializers.ModelSerializer):
    """Serializer for Notification model."""

    related_user = RelatedUserSerializer(read_only=True)
    notification_type_display = serializers.CharField(
        source="get_notification_type_display", read_only=True
    )

    class Meta:
        model = Notification
        fields = [
            "id",
            "notification_type",
            "notification_type_display",
            "title",
            "message",
            "link",
            "is_read",
            "related_user",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    """Serializer for NotificationPreference model."""

    class Meta:
        model = NotificationPreference
        fields = [
            "id",
            # In-app preferences
            "notify_messages",
            "notify_announcements",
            "notify_forum_subscriptions",
            "notify_thread_replies",
            "notify_event_reminders",
            "notify_food_tickets",
            # Email preferences
            "email_messages",
            "email_announcements",
            "email_forum_subscriptions",
            "email_thread_replies",
            "email_event_reminders",
            "email_food_tickets",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class MarkNotificationsReadSerializer(serializers.Serializer):
    """Serializer for marking notifications as read."""

    notification_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        help_text="List of notification IDs to mark as read. If empty, marks all as read.",
    )
