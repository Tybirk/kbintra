"""
Huey background tasks for sending email and push notifications.
"""

import contextlib
import logging

from huey.contrib.djhuey import db_task

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Low-level tasks (called by create_notification in services.py)
# ---------------------------------------------------------------------------


@db_task(retries=3, retry_delay=60)
def send_email_task(
    user_id: int,
    notification_type: str,
    title: str,
    message: str,
    link: str,
    related_user_id: int | None,
    html_content: str | None,
) -> None:
    """Send notification email in background."""
    from apps.users.models import User

    from .email_service import send_notification_email

    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        logger.warning(f"send_email_task: User {user_id} not found")
        return

    related_user = None
    if related_user_id:
        with contextlib.suppress(User.DoesNotExist):
            related_user = User.objects.get(id=related_user_id)

    send_notification_email(
        user=user,
        notification_type=notification_type,
        title=title,
        message=message,
        link=link,
        related_user=related_user,
        html_content=html_content,
    )


@db_task(retries=2, retry_delay=60)
def send_push_task(
    user_id: int,
    notification_type: str,
    title: str,
    message: str,
    link: str,
) -> None:
    """Send push notification in background."""
    from apps.users.models import User

    from .services import send_push_notification

    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        logger.warning(f"send_push_task: User {user_id} not found")
        return

    send_push_notification(
        user=user,
        notification_type=notification_type,
        title=title,
        message=message,
        link=link,
    )


# ---------------------------------------------------------------------------
# Password reset email
# ---------------------------------------------------------------------------


@db_task(retries=3, retry_delay=60)
def send_password_reset_email_task(
    first_name: str,
    email: str,
    reset_url: str,
) -> None:
    """Send password reset email in background."""
    from django.conf import settings
    from django.core.mail import send_mail

    send_mail(
        subject="Nulstil din adgangskode - KB Intra",
        message=f"""Hej {first_name},

Du har anmodet om at nulstille din adgangskode til KB Intra.

Klik på linket herunder for at vælge en ny adgangskode:
{reset_url}

Linket udløber om 1 time.

Hvis du ikke har anmodet om at nulstille din adgangskode, kan du ignorere denne email.

Med venlig hilsen,
KB Intra
""",
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[email],
    )


# ---------------------------------------------------------------------------
# Bulk notification tasks (offload loops from request path)
# ---------------------------------------------------------------------------


@db_task(retries=1, retry_delay=60)
def notify_new_announcement_task(
    author_id: int,
    announcement_title: str,
    announcement_id: int,
    announcement_content: str,
) -> None:
    """Send announcement notifications to all users in background."""
    from apps.users.models import User

    from .services import notify_new_announcement

    try:
        author = User.objects.get(id=author_id)
    except User.DoesNotExist:
        logger.warning("notify_new_announcement_task: Author %d not found", author_id)
        return

    recipients = User.objects.exclude(id=author_id)
    notify_new_announcement(
        recipients=recipients,
        author=author,
        announcement_title=announcement_title,
        announcement_id=announcement_id,
        announcement_content=announcement_content,
    )


@db_task(retries=1, retry_delay=60)
def notify_new_thread_task(
    author_id: int,
    thread_title: str,
    thread_id: int,
    subgroup_name: str,
    subgroup_slug: str,
    subgroup_id: int,
    initial_post_content: str,
) -> None:
    """Send new-thread notifications to subscribers in background."""
    from apps.users.models import User

    from .services import notify_new_thread

    try:
        author = User.objects.get(id=author_id)
    except User.DoesNotExist:
        logger.warning("notify_new_thread_task: Author %d not found", author_id)
        return

    subscribers = User.objects.filter(
        subgroup_subscriptions__subgroup_id=subgroup_id,
        subgroup_subscriptions__notify_new_threads=True,
    )
    notify_new_thread(
        subscribers=subscribers,
        author=author,
        thread_title=thread_title,
        thread_id=thread_id,
        subgroup_name=subgroup_name,
        subgroup_slug=subgroup_slug,
        initial_post_content=initial_post_content,
    )


@db_task(retries=1, retry_delay=60)
def notify_new_message_task(
    recipient_id: int,
    sender_id: int,
    message_content: str,
    conversation_id: int,
) -> None:
    """Send message notification in background."""
    from apps.users.models import User

    from .services import notify_new_message

    try:
        recipient = User.objects.get(id=recipient_id)
    except User.DoesNotExist:
        logger.warning("notify_new_message_task: Recipient %d not found", recipient_id)
        return

    try:
        sender = User.objects.get(id=sender_id)
    except User.DoesNotExist:
        logger.warning("notify_new_message_task: Sender %d not found", sender_id)
        return

    notify_new_message(
        recipient=recipient,
        sender=sender,
        message_content=message_content,
        conversation_id=conversation_id,
    )


@db_task(retries=1, retry_delay=60)
def notify_thread_reply_task(
    thread_author_id: int,
    replier_id: int,
    thread_title: str,
    thread_id: int,
    subgroup_slug: str,
    reply_content: str,
) -> None:
    """Send thread reply notification in background."""
    from apps.users.models import User

    from .services import notify_thread_reply

    try:
        thread_author = User.objects.get(id=thread_author_id)
    except User.DoesNotExist:
        logger.warning("notify_thread_reply_task: Thread author %d not found", thread_author_id)
        return

    try:
        replier = User.objects.get(id=replier_id)
    except User.DoesNotExist:
        logger.warning("notify_thread_reply_task: Replier %d not found", replier_id)
        return

    notify_thread_reply(
        thread_author=thread_author,
        replier=replier,
        thread_title=thread_title,
        thread_id=thread_id,
        subgroup_slug=subgroup_slug,
        reply_content=reply_content,
    )


@db_task(retries=1, retry_delay=60)
def notify_post_reply_task(
    post_author_id: int,
    replier_id: int,
    thread_title: str,
    thread_id: int,
    subgroup_slug: str,
    reply_content: str,
) -> None:
    """Send post reply notification in background."""
    from apps.users.models import User

    from .services import notify_post_reply

    try:
        post_author = User.objects.get(id=post_author_id)
    except User.DoesNotExist:
        logger.warning("notify_post_reply_task: Post author %d not found", post_author_id)
        return

    try:
        replier = User.objects.get(id=replier_id)
    except User.DoesNotExist:
        logger.warning("notify_post_reply_task: Replier %d not found", replier_id)
        return

    notify_post_reply(
        post_author=post_author,
        replier=replier,
        thread_title=thread_title,
        thread_id=thread_id,
        subgroup_slug=subgroup_slug,
        reply_content=reply_content,
    )


# ---------------------------------------------------------------------------
# Drive menu refresh
# ---------------------------------------------------------------------------


@db_task(retries=1, retry_delay=60)
def refresh_all_drive_menus_task() -> None:
    """Refresh all Google Drive menus in background."""
    from apps.food.services.drive_menu import DriveMenuService

    service = DriveMenuService()
    result = service.refresh_all_menus()
    logger.info("Drive menu refresh: %d updated, %d failed", result["updated"], result["failed"])
