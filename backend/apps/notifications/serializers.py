"""
Serializers for Notifications models.
"""

from rest_framework import serializers

from apps.users.models import User
from apps.users.serializer_mixins import AvatarUrlMixin

from .models import Notification, NotificationPreference, PushSubscription


class RelatedUserSerializer(AvatarUrlMixin, serializers.ModelSerializer):
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
            "aggregate_count",
            "related_user",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "aggregate_count", "created_at", "updated_at"]


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    """Serializer for NotificationPreference model."""

    class Meta:
        model = NotificationPreference
        fields = [
            "id",
            # In-app preferences
            "notify_message_reactions",
            "notify_announcements",
            "notify_announcement_updates",
            "notify_forum_subscriptions",
            "notify_thread_replies",
            "notify_subgroup_activity",
            "notify_post_reactions",
            "notify_events",
            "notify_event_reminders",
            "notify_food_tickets",
            "notify_mentions",
            # Email preferences
            "email_messages",
            "email_announcements",
            "email_announcement_updates",
            "email_forum_subscriptions",
            "email_thread_replies",
            "email_subgroup_activity",
            "email_post_reactions",
            "email_events",
            "email_event_reminders",
            "email_food_tickets",
            "email_mentions",
            # Push preferences
            "push_messages",
            "push_announcements",
            "push_announcement_updates",
            "push_forum_subscriptions",
            "push_thread_replies",
            "push_subgroup_activity",
            "push_post_reactions",
            "push_events",
            "push_event_reminders",
            "push_food_tickets",
            "push_mentions",
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


class PushSubscriptionSerializer(serializers.ModelSerializer):
    """Serializer for PushSubscription model."""

    class Meta:
        model = PushSubscription
        fields = ["id", "endpoint", "p256dh_key", "auth_key", "user_agent", "created_at"]
        read_only_fields = ["id", "created_at"]

    def create(self, validated_data: dict) -> PushSubscription:
        """Create or update push subscription."""
        user = self.context["request"].user
        endpoint = validated_data["endpoint"]

        # Scoped to user so one user's subscription can't overwrite another's.
        PushSubscription.objects.filter(endpoint=endpoint).exclude(user=user).delete()

        subscription, created = PushSubscription.objects.update_or_create(
            endpoint=endpoint,
            user=user,
            defaults={
                "p256dh_key": validated_data["p256dh_key"],
                "auth_key": validated_data["auth_key"],
                "user_agent": validated_data.get("user_agent", ""),
            },
        )
        return subscription


class PushSubscriptionInputSerializer(serializers.Serializer):
    """Serializer for push subscription input from frontend."""

    endpoint = serializers.URLField()
    keys = serializers.DictField(child=serializers.CharField())

    def validate_keys(self, value: dict) -> dict:
        """Validate that required keys are present."""
        if "p256dh" not in value:
            raise serializers.ValidationError("Missing 'p256dh' key")
        if "auth" not in value:
            raise serializers.ValidationError("Missing 'auth' key")
        return value

    def create(self, validated_data: dict) -> PushSubscription:
        """Create push subscription from browser format."""
        user = self.context["request"].user
        endpoint = validated_data["endpoint"]
        keys = validated_data["keys"]

        # Get user agent from request
        request = self.context.get("request")
        user_agent = ""
        if request:
            user_agent = request.META.get("HTTP_USER_AGENT", "")[:500]

        # Scoped to user so one user's subscription can't overwrite another's.
        # Also clean up any other user's subscription on the same endpoint
        # (an endpoint should never belong to two users simultaneously).
        PushSubscription.objects.filter(endpoint=endpoint).exclude(user=user).delete()

        subscription, created = PushSubscription.objects.update_or_create(
            endpoint=endpoint,
            user=user,
            defaults={
                "p256dh_key": keys["p256dh"],
                "auth_key": keys["auth"],
                "user_agent": user_agent,
            },
        )
        subscription._was_created = created
        return subscription
