"""
Admin configuration for Notifications app.
"""

from django.contrib import admin

from .models import Notification, NotificationPreference, PushSubscription


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    """Admin for Notification model."""

    list_display = [
        "id",
        "user",
        "notification_type",
        "title",
        "is_read",
        "created_at",
    ]
    list_filter = ["notification_type", "is_read", "created_at"]
    search_fields = ["user__first_name", "user__last_name", "user__email", "title", "message"]
    readonly_fields = ["created_at"]
    raw_id_fields = ["user", "related_user"]
    ordering = ["-created_at"]


@admin.register(NotificationPreference)
class NotificationPreferenceAdmin(admin.ModelAdmin):
    """Admin for NotificationPreference model."""

    list_display = [
        "id",
        "user",
        "notify_messages",
        "notify_announcements",
        "email_messages",
        "email_announcements",
    ]
    list_filter = ["notify_messages", "email_messages", "email_announcements"]
    search_fields = ["user__first_name", "user__last_name", "user__email"]
    raw_id_fields = ["user"]


@admin.register(PushSubscription)
class PushSubscriptionAdmin(admin.ModelAdmin):
    """Admin for PushSubscription model."""

    list_display = ["id", "user", "endpoint_short", "created_at", "updated_at"]
    list_filter = ["created_at"]
    search_fields = ["user__first_name", "user__last_name", "user__email", "endpoint"]
    raw_id_fields = ["user"]
    readonly_fields = ["created_at", "updated_at"]
    ordering = ["-created_at"]

    @admin.display(description="Endpoint")
    def endpoint_short(self, obj: PushSubscription) -> str:
        """Display truncated endpoint."""
        return f"{obj.endpoint[:60]}..." if len(obj.endpoint) > 60 else obj.endpoint
