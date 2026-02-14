"""
Email service for sending notification emails.
"""

import logging
import os

from django.conf import settings
from django.core.mail import EmailMessage, get_connection
from django.template.loader import render_to_string

from apps.users.models import User

from .models import NotificationPreference, NotificationType

logger = logging.getLogger(__name__)


def should_send_email(user: User, notification_type: NotificationType) -> bool:
    """Check if user wants to receive email for this notification type."""
    try:
        prefs = user.notification_preferences
    except NotificationPreference.DoesNotExist:
        return False

    preference_map = {
        NotificationType.NEW_MESSAGE: prefs.email_messages,
        NotificationType.NEW_ANNOUNCEMENT: prefs.email_announcements,
        NotificationType.NEW_THREAD: prefs.email_forum_subscriptions,
        NotificationType.THREAD_REPLY: prefs.email_thread_replies,
        NotificationType.POST_REPLY: prefs.email_thread_replies,
        NotificationType.POST_REACTION: prefs.email_post_reactions,
        NotificationType.EVENT_REMINDER: prefs.email_event_reminders,
        NotificationType.FOOD_TICKET: prefs.email_food_tickets,
    }

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
        subject = f"[KB Intra] {title}"

        with get_connection(
            backend="django.core.mail.backends.smtp.EmailBackend",
            host=settings.RESEND_SMTP_HOST,
            port=settings.RESEND_SMTP_PORT,
            username=settings.RESEND_SMTP_USERNAME,
            password=os.environ.get("RESEND_API_KEY", ""),
            use_tls=True,
        ) as connection:
            email = EmailMessage(
                subject=subject,
                body=html_message,
                to=[user.email],
                from_email=settings.DEFAULT_FROM_EMAIL,
                connection=connection,
            )
            email.content_subtype = "html"
            email.send()

        logger.info(f"Sent notification email to {user.email}: {title}")
        return True

    except Exception:
        logger.exception(f"Failed to send notification email to {user.email}")
        raise
