"""
Admin configuration for User models.
"""

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from apps.forum.models import SubgroupSubscription
from apps.notifications.models import NotificationPreference, PushSubscription

from .models import Invitation, PasswordResetToken, User


class NotificationPreferenceInline(admin.StackedInline):
    model = NotificationPreference
    can_delete = False
    fieldsets = [
        (
            "In-app",
            {
                "fields": [
                    "notify_messages",
                    "notify_announcements",
                    "notify_forum_subscriptions",
                    "notify_thread_replies",
                    "notify_post_reactions",
                    "notify_events",
                    "notify_event_reminders",
                    "notify_food_tickets",
                    "notify_mentions",
                ]
            },
        ),
        (
            "Email",
            {
                "fields": [
                    "email_messages",
                    "email_announcements",
                    "email_forum_subscriptions",
                    "email_thread_replies",
                    "email_post_reactions",
                    "email_events",
                    "email_event_reminders",
                    "email_food_tickets",
                    "email_mentions",
                ]
            },
        ),
        (
            "Push",
            {
                "fields": [
                    "push_messages",
                    "push_announcements",
                    "push_forum_subscriptions",
                    "push_thread_replies",
                    "push_post_reactions",
                    "push_events",
                    "push_event_reminders",
                    "push_food_tickets",
                    "push_mentions",
                ]
            },
        ),
    ]


class PushSubscriptionInline(admin.TabularInline):
    model = PushSubscription
    extra = 0
    readonly_fields = ["endpoint_short", "user_agent", "created_at", "updated_at"]
    fields = ["endpoint_short", "user_agent", "created_at", "updated_at"]

    @admin.display(description="Endpoint")
    def endpoint_short(self, obj: PushSubscription) -> str:
        return f"{obj.endpoint[:80]}..." if len(obj.endpoint) > 80 else obj.endpoint

    def has_add_permission(self, request, obj=None):
        return False


class SubgroupSubscriptionInline(admin.TabularInline):
    model = SubgroupSubscription
    extra = 0
    fields = ["subgroup", "notify_new_threads", "notify_replies", "created_at"]
    readonly_fields = ["created_at"]


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    """Admin configuration for custom User model."""

    list_display = (
        "email",
        "first_name",
        "last_name",
        "house",
        "is_staff",
        "is_active",
    )
    list_filter = ("is_staff", "is_superuser", "is_active", "house")
    search_fields = ("email", "first_name", "last_name")
    ordering = ("email",)
    inlines = [
        NotificationPreferenceInline,
        PushSubscriptionInline,
        SubgroupSubscriptionInline,
    ]

    fieldsets = (
        (None, {"fields": ("email", "password")}),
        (
            "Personal info",
            {
                "fields": (
                    "first_name",
                    "last_name",
                    "phone_number",
                    "birthdate",
                    "profile_picture",
                    "bio",
                )
            },
        ),
        ("House", {"fields": ("house",)}),
        (
            "Permissions",
            {
                "fields": (
                    "is_active",
                    "is_staff",
                    "is_superuser",
                    "groups",
                    "user_permissions",
                ),
            },
        ),
        ("Important dates", {"fields": ("last_login", "date_joined")}),
    )

    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": ("email", "password1", "password2"),
            },
        ),
    )


@admin.register(Invitation)
class InvitationAdmin(admin.ModelAdmin):
    """Admin configuration for Invitation model."""

    list_display = ("email", "created_by", "created_at", "used_at", "is_valid_display")
    list_filter = ("created_at", "used_at")
    search_fields = ("email", "created_by__email")
    readonly_fields = ("token", "created_at", "used_at")
    ordering = ("-created_at",)

    @admin.display(boolean=True, description="Valid")
    def is_valid_display(self, obj: Invitation) -> bool:
        """Display whether invitation is still valid."""
        return obj.is_valid


@admin.register(PasswordResetToken)
class PasswordResetTokenAdmin(admin.ModelAdmin):
    """Admin configuration for PasswordResetToken model."""

    list_display = ("user", "created_at", "used_at", "is_valid_display")
    list_filter = ("created_at", "used_at")
    search_fields = ("user__email", "user__first_name", "user__last_name")
    readonly_fields = ("token", "created_at", "used_at")
    ordering = ("-created_at",)

    @admin.display(boolean=True, description="Valid")
    def is_valid_display(self, obj: PasswordResetToken) -> bool:
        """Display whether token is still valid."""
        return obj.is_valid
