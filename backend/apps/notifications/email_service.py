"""
Email service for sending notification emails.
"""

import logging

from django.conf import settings
from django.core.mail import EmailMessage
from django.template.loader import render_to_string

from apps.users.models import User

from .models import NotificationPreference, NotificationType

logger = logging.getLogger(__name__)

# Type-specific email subject prefixes (more informative than generic [KB Intra])
EMAIL_SUBJECT_PREFIX: dict[str, str] = {
    NotificationType.NEW_ANNOUNCEMENT: "[Vigtig post]",
    NotificationType.ANNOUNCEMENT_UPDATED: "[Vigtig post]",
    NotificationType.NEW_THREAD: "[Forum]",
    NotificationType.THREAD_REPLY: "[Forum]",
    NotificationType.POST_REPLY: "[Forum]",
    NotificationType.POST_REACTION: "[Forum]",
    NotificationType.SUBGROUP_ACTIVITY: "[Forum]",
    NotificationType.SUBGROUP_MEMBER_ADDED: "[Forum]",
    NotificationType.SUBGROUP_MEMBER_REMOVED: "[Forum]",
    NotificationType.NEW_MESSAGE: "[Besked]",
    NotificationType.MESSAGE_REACTION: "[Besked]",
    NotificationType.FOOD_TICKET: "[Mad]",
    NotificationType.FOOD_TEAM_REMINDER: "[Madhold]",
    NotificationType.FOOD_TEAM_TAKEAWAY_READY: "[Madhold]",
    NotificationType.FOOD_TEAM_LEFTOVERS_READY: "[Madhold]",
    NotificationType.FOOD_TEAM_SWAP_REQUEST: "[Madhold]",
    NotificationType.EVENT_CREATED: "[Kalender]",
    NotificationType.EVENT_UPDATED: "[Kalender]",
    NotificationType.EVENT_CANCELLED: "[Kalender]",
    NotificationType.EVENT_REMINDER: "[Kalender]",
    NotificationType.MENTION: "[Omtale]",
    NotificationType.EXPENSE_PROCESSED: "[Udlæg]",
}


def should_send_email(user: User, notification_type: NotificationType) -> bool:
    """Check if user wants to receive email for this notification type."""
    try:
        prefs = user.notification_preferences
    except NotificationPreference.DoesNotExist:
        return False

    preference_map = {
        NotificationType.NEW_MESSAGE: prefs.email_messages,
        NotificationType.NEW_ANNOUNCEMENT: prefs.email_announcements,
        NotificationType.ANNOUNCEMENT_UPDATED: prefs.email_announcement_updates,
        NotificationType.NEW_THREAD: prefs.email_forum_subscriptions,
        NotificationType.THREAD_REPLY: prefs.email_thread_replies,
        NotificationType.POST_REPLY: prefs.email_thread_replies,
        NotificationType.SUBGROUP_ACTIVITY: prefs.email_subgroup_activity,
        NotificationType.POST_REACTION: prefs.email_post_reactions,
        NotificationType.MESSAGE_REACTION: prefs.email_messages,
        NotificationType.EVENT_CREATED: prefs.email_events,
        NotificationType.EVENT_UPDATED: prefs.email_events,
        NotificationType.EVENT_CANCELLED: prefs.email_events,
        NotificationType.EVENT_REMINDER: prefs.email_event_reminders,
        NotificationType.FOOD_TICKET: prefs.email_food_tickets,
        NotificationType.FOOD_TEAM_REMINDER: prefs.email_food_team_reminder,
        NotificationType.FOOD_TEAM_TAKEAWAY_READY: prefs.email_food_takeaway_ready,
        NotificationType.FOOD_TEAM_LEFTOVERS_READY: prefs.email_food_leftovers_ready,
        NotificationType.FOOD_TEAM_SWAP_REQUEST: prefs.email_food_swap_request,
        NotificationType.MENTION: prefs.email_mentions,
    }

    # Expense outcomes have no dedicated email toggle — they piggyback on
    # whatever email channels the user already has enabled (email if any email).
    if notification_type == NotificationType.EXPENSE_PROCESSED:
        return any(
            (
                prefs.email_messages,
                prefs.email_announcements,
                prefs.email_announcement_updates,
                prefs.email_forum_subscriptions,
                prefs.email_thread_replies,
                prefs.email_subgroup_activity,
                prefs.email_post_reactions,
                prefs.email_events,
                prefs.email_event_reminders,
                prefs.email_food_tickets,
                prefs.email_mentions,
            )
        )

    return preference_map.get(notification_type, False)


def send_notification_email(
    user: User,
    notification_type: NotificationType,
    title: str,
    message: str,
    link: str = "",
    related_user: User | None = None,
    html_content: str | None = None,
) -> bool:
    """Send a notification email to a user.

    Args:
        user: The user to send email to
        notification_type: Type of notification
        title: Email subject/title
        message: Email body content (plain text summary)
        link: Optional link to include in email
        related_user: Optional user who triggered the notification
        html_content: Optional rich HTML content (for announcements, posts, etc.)

    Returns:
        True if email was sent successfully, False otherwise
    """
    if not should_send_email(user, notification_type):
        return False

    if not user.email:
        logger.warning(f"User {user.id} has no email address")
        return False

    # Build the full URL for the link
    site_url = getattr(settings, "SITE_URL", "http://localhost:5173")
    full_link = f"{site_url}{link}" if link else site_url

    # Context for email template
    context = {
        "user": user,
        "title": title,
        "message": message,
        "html_content": html_content,
        "link": full_link,
        "related_user": related_user,
        "notification_type": notification_type,
        "notification_type_display": dict(NotificationType.choices).get(
            notification_type, notification_type
        ),
        "site_url": site_url,
    }

    try:
        html_message = render_to_string("notifications/email_notification.html", context)
        prefix = EMAIL_SUBJECT_PREFIX.get(notification_type, "[KB Intra]")
        subject = f"{prefix} {title}"

        email = EmailMessage(
            subject=subject,
            body=html_message,
            to=[user.email],
            from_email=settings.DEFAULT_FROM_EMAIL,
        )
        email.content_subtype = "html"
        email.send()

        logger.info(f"Sent notification email to {user.email}: {title}")
        return True

    except Exception:
        logger.exception(f"Failed to send notification email to {user.email}")
        raise
