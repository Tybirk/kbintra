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
    logger.info(
        "send_email_task STARTED: user=%d type=%s title='%s'", user_id, notification_type, title
    )
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

    from django.db import connection

    connection.close()  # Release DB connection before SMTP call
    send_notification_email(
        user=user,
        notification_type=notification_type,
        title=title,
        message=message,
        link=link,
        related_user=related_user,
        html_content=html_content,
    )
    logger.info("send_email_task COMPLETED: user=%d type=%s", user_id, notification_type)


@db_task(retries=2, retry_delay=60)
def send_push_task(
    user_id: int,
    notification_type: str,
    title: str,
    message: str,
    link: str,
) -> None:
    """Send push notification in background."""
    logger.info(
        "send_push_task STARTED: user=%d type=%s title='%s'", user_id, notification_type, title
    )
    from apps.users.models import User

    from .services import send_push_notification

    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        logger.warning(f"send_push_task: User {user_id} not found")
        return

    from django.db import connection

    connection.close()  # Release DB connection before HTTP push calls
    send_push_notification(
        user=user,
        notification_type=notification_type,
        title=title,
        message=message,
        link=link,
    )
    logger.info("send_push_task COMPLETED: user=%d type=%s", user_id, notification_type)


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
    from django.core.mail import EmailMessage

    from .email_service import get_resend_connection

    with get_resend_connection() as connection:
        EmailMessage(
            subject="Nulstil din adgangskode - KB Intra",
            body=f"""Hej {first_name},

Du har anmodet om at nulstille din adgangskode til KB Intra.

Klik på linket herunder for at vælge en ny adgangskode:
{reset_url}

Linket udløber om 1 time.

Hvis du ikke har anmodet om at nulstille din adgangskode, kan du ignorere denne email.

Med venlig hilsen,
KB Intra
""",
            to=[email],
            from_email=settings.DEFAULT_FROM_EMAIL,
            connection=connection,
        ).send()


# ---------------------------------------------------------------------------
# Email change verification
# ---------------------------------------------------------------------------


@db_task(retries=3, retry_delay=60)
def send_email_change_verification_task(
    first_name: str,
    new_email: str,
    confirm_url: str,
) -> None:
    """Send email change verification email in background."""
    from django.conf import settings
    from django.core.mail import EmailMessage

    from .email_service import get_resend_connection

    with get_resend_connection() as connection:
        EmailMessage(
            subject="Bekræft din nye emailadresse - KB Intra",
            body=f"""Hej {first_name},

Du har anmodet om at ændre din emailadresse på KB Intra.

Klik på linket herunder for at bekræfte din nye emailadresse:
{confirm_url}

Linket udløber om 1 time.

Hvis du ikke har anmodet om denne ændring, kan du ignorere denne email.

Med venlig hilsen,
KB Intra
""",
            to=[new_email],
            from_email=settings.DEFAULT_FROM_EMAIL,
            connection=connection,
        ).send()


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
    logger.info(
        "notify_new_announcement_task STARTED: author=%d title='%s'", author_id, announcement_title
    )
    from apps.users.models import User

    from .services import notify_new_announcement

    try:
        author = User.objects.get(id=author_id)
    except User.DoesNotExist:
        logger.warning("notify_new_announcement_task: Author %d not found", author_id)
        return

    recipients = User.objects.filter(is_active=True).exclude(id=author_id)
    count = notify_new_announcement(
        recipients=recipients,
        author=author,
        announcement_title=announcement_title,
        announcement_id=announcement_id,
        announcement_content=announcement_content,
    )
    logger.info("notify_new_announcement_task COMPLETED: %d notifications created", count)


@db_task(retries=1, retry_delay=60)
def notify_new_thread_task(
    author_id: int,
    thread_title: str,
    thread_id: int,
    subgroup_name: str,
    subgroup_slug: str,
    subgroup_id: int,
    thread_slug: str,
    initial_post_content: str,
    exclude_user_ids: list[int] | None = None,
    members_only: bool = False,
) -> None:
    """Send new-thread notifications to subscribers in background."""
    logger.info("notify_new_thread_task STARTED: author=%d thread='%s'", author_id, thread_title)
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
    if members_only:
        # Restrict to (current members of subgroup ∪ {author}).
        from apps.forum.models import SubgroupMembership

        member_ids = set(
            SubgroupMembership.objects.filter(subgroup_id=subgroup_id).values_list(
                "user_id", flat=True
            )
        )
        member_ids.add(author_id)
        subscribers = subscribers.filter(id__in=member_ids)
    if exclude_user_ids:
        subscribers = subscribers.exclude(id__in=exclude_user_ids)
    count = notify_new_thread(
        subscribers=subscribers,
        author=author,
        thread_title=thread_title,
        thread_id=thread_id,
        subgroup_name=subgroup_name,
        subgroup_slug=subgroup_slug,
        thread_slug=thread_slug,
        initial_post_content=initial_post_content,
    )
    logger.info("notify_new_thread_task COMPLETED: %d notifications created", count)


@db_task(retries=1, retry_delay=60)
def notify_new_message_task(
    recipient_id: int,
    sender_id: int,
    message_content: str,
    conversation_id: int,
    message_id: int = 0,
) -> None:
    """Send message notification in background."""
    logger.info("notify_new_message_task STARTED: recipient=%d sender=%d", recipient_id, sender_id)
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
        message_id=message_id,
    )
    logger.info(
        "notify_new_message_task COMPLETED: recipient=%d sender=%d", recipient_id, sender_id
    )


@db_task(retries=1, retry_delay=60)
def notify_message_reaction_task(
    message_author_id: int,
    reactor_id: int,
    reaction_emoji: str,
    conversation_id: int,
    message_id: int,
) -> None:
    """Send message reaction notification in background."""
    logger.info(
        "notify_message_reaction_task STARTED: message_author=%d reactor=%d",
        message_author_id,
        reactor_id,
    )
    from apps.users.models import User

    from .services import notify_message_reaction

    try:
        message_author = User.objects.get(id=message_author_id)
    except User.DoesNotExist:
        logger.warning(
            "notify_message_reaction_task: Message author %d not found", message_author_id
        )
        return

    try:
        reactor = User.objects.get(id=reactor_id)
    except User.DoesNotExist:
        logger.warning("notify_message_reaction_task: Reactor %d not found", reactor_id)
        return

    notify_message_reaction(
        message_author=message_author,
        reactor=reactor,
        reaction_emoji=reaction_emoji,
        conversation_id=conversation_id,
        message_id=message_id,
    )
    logger.info(
        "notify_message_reaction_task COMPLETED: message_author=%d reactor=%d",
        message_author_id,
        reactor_id,
    )


@db_task(retries=1, retry_delay=60)
def notify_thread_reply_task(
    thread_author_id: int,
    replier_id: int,
    thread_title: str,
    thread_id: int,
    subgroup_slug: str,
    thread_slug: str,
    reply_content: str,
    post_id: int = 0,
) -> None:
    """Send thread reply notification in background."""
    logger.info(
        "notify_thread_reply_task STARTED: thread_author=%d replier=%d",
        thread_author_id,
        replier_id,
    )
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
        thread_slug=thread_slug,
        reply_content=reply_content,
        post_id=post_id,
    )
    logger.info(
        "notify_thread_reply_task COMPLETED: thread_author=%d replier=%d",
        thread_author_id,
        replier_id,
    )


@db_task(retries=1, retry_delay=60)
def notify_post_reply_task(
    post_author_id: int,
    replier_id: int,
    thread_title: str,
    thread_id: int,
    subgroup_slug: str,
    thread_slug: str,
    reply_content: str,
    post_id: int = 0,
) -> None:
    """Send post reply notification in background."""
    logger.info(
        "notify_post_reply_task STARTED: post_author=%d replier=%d", post_author_id, replier_id
    )
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
        thread_slug=thread_slug,
        reply_content=reply_content,
        post_id=post_id,
    )
    logger.info(
        "notify_post_reply_task COMPLETED: post_author=%d replier=%d", post_author_id, replier_id
    )


@db_task(retries=1, retry_delay=60)
def notify_event_created_task(
    event_id: int,
    author_id: int,
) -> None:
    """Send event-created notifications to all users in background."""
    logger.info("notify_event_created_task STARTED: event=%d author=%d", event_id, author_id)
    from apps.users.models import User

    from .services import notify_event_created

    try:
        author = User.objects.get(id=author_id)
    except User.DoesNotExist:
        logger.warning("notify_event_created_task: Author %d not found", author_id)
        return

    count = notify_event_created(event_id=event_id, author=author)
    logger.info("notify_event_created_task COMPLETED: %d notifications created", count)


@db_task(retries=1, retry_delay=60)
def notify_event_updated_task(
    event_id: int,
    updater_id: int,
) -> None:
    """Send event-updated notifications in background."""
    logger.info("notify_event_updated_task STARTED: event=%d updater=%d", event_id, updater_id)
    from apps.users.models import User

    from .services import notify_event_updated

    try:
        updater = User.objects.get(id=updater_id)
    except User.DoesNotExist:
        logger.warning("notify_event_updated_task: Updater %d not found", updater_id)
        return

    count = notify_event_updated(event_id=event_id, updater=updater)
    logger.info("notify_event_updated_task COMPLETED: %d notifications created", count)


@db_task(retries=1, retry_delay=60)
def notify_event_cancelled_task(
    event_id: int,
    canceller_id: int,
) -> None:
    """Send event-cancelled notifications in background."""
    logger.info(
        "notify_event_cancelled_task STARTED: event=%d canceller=%d", event_id, canceller_id
    )
    from apps.users.models import User

    from .services import notify_event_cancelled

    try:
        canceller = User.objects.get(id=canceller_id)
    except User.DoesNotExist:
        logger.warning("notify_event_cancelled_task: Canceller %d not found", canceller_id)
        return

    count = notify_event_cancelled(event_id=event_id, canceller=canceller)
    logger.info("notify_event_cancelled_task COMPLETED: %d notifications created", count)


@db_task(retries=1, retry_delay=60)
def notify_event_reminder_task(
    event_id: int,
    reminder_type: str,
) -> None:
    """Send reminder notifications for an upcoming event and record in the log."""
    logger.info("notify_event_reminder_task STARTED: event=%d type=%s", event_id, reminder_type)
    from apps.events.models import EventReminderLog

    from .services import notify_event_reminder

    count = notify_event_reminder(event_id=event_id, reminder_type=reminder_type)
    # Upsert the log — update_or_create handles the race condition where two
    # workers might attempt the same reminder simultaneously.
    EventReminderLog.objects.update_or_create(
        event_id=event_id,
        reminder_type=reminder_type,
        defaults={"recipients_count": count},
    )
    logger.info("notify_event_reminder_task COMPLETED: %d notifications sent", count)


@db_task(retries=1, retry_delay=60)
def notify_mentions_task(
    author_id: int,
    mentioned_user_ids: list[int],
    context_label: str,
    link: str,
    exclude_user_ids: list[int] | None = None,
) -> None:
    """Notify mentioned users in background."""
    logger.info(
        "notify_mentions_task STARTED: author=%d mentioned=%s", author_id, mentioned_user_ids
    )
    from apps.users.models import User

    from .services import notify_mentions

    try:
        author = User.objects.get(id=author_id)
    except User.DoesNotExist:
        logger.warning("notify_mentions_task: Author %d not found", author_id)
        return

    count = notify_mentions(
        author=author,
        mentioned_user_ids=mentioned_user_ids,
        context_label=context_label,
        link=link,
        exclude_user_ids=exclude_user_ids,
    )
    logger.info("notify_mentions_task COMPLETED: %d notifications created", count)


@db_task(retries=1, retry_delay=60)
def notify_announcement_updated_task(
    editor_id: int,
    announcement_title: str,
    announcement_id: int,
) -> None:
    """Send announcement-updated notifications to all users in background."""
    logger.info(
        "notify_announcement_updated_task STARTED: editor=%d title='%s'",
        editor_id,
        announcement_title,
    )
    from apps.users.models import User

    from .services import notify_announcement_updated

    try:
        editor = User.objects.get(id=editor_id)
    except User.DoesNotExist:
        logger.warning("notify_announcement_updated_task: Editor %d not found", editor_id)
        return

    recipients = User.objects.filter(is_active=True).exclude(id=editor_id)
    count = notify_announcement_updated(
        recipients=recipients,
        editor=editor,
        announcement_title=announcement_title,
        announcement_id=announcement_id,
    )
    logger.info("notify_announcement_updated_task COMPLETED: %d notifications created", count)


@db_task(retries=1, retry_delay=60)
def notify_subgroup_activity_task(
    replier_id: int,
    thread_title: str,
    thread_id: int,
    subgroup_id: int,
    subgroup_name: str,
    subgroup_slug: str,
    thread_slug: str,
    reply_content: str,
    post_id: int,
    participant_ids: list[int],
    mentioned_ids: list[int],
    members_only: bool = False,
) -> None:
    """Notify subgroup subscribers about new thread activity in background.

    participant_ids: replier + thread author + previous posters (routed to THREAD_REPLY/POST_REPLY)
    mentioned_ids: effective mentioned users (who will actually receive MENTION)

    Only participants who opted OUT of thread_replies fall back to SUBGROUP_ACTIVITY here.
    """
    logger.info(
        "notify_subgroup_activity_task STARTED: replier=%d thread='%s'",
        replier_id,
        thread_title,
    )
    from apps.users.models import User

    from .services import notify_subgroup_activity

    try:
        replier = User.objects.get(id=replier_id)
    except User.DoesNotExist:
        logger.warning("notify_subgroup_activity_task: Replier %d not found", replier_id)
        return

    from apps.forum.models import ThreadMuteStatus
    from apps.notifications.models import NotificationPreference

    # Among participants, only exclude those who will ACTUALLY receive THREAD_REPLY/POST_REPLY.
    # A participant with notify_thread_replies=False won't get that notification, so they
    # should fall through to SUBGROUP_ACTIVITY instead.
    participants_opting_out = set(
        NotificationPreference.objects.filter(
            user_id__in=participant_ids,
            notify_thread_replies=False,
        ).values_list("user_id", flat=True)
    )
    # Exclude participants who WILL get thread_reply (True or no prefs row → default True)
    participants_to_exclude = set(participant_ids) - participants_opting_out

    final_exclude = participants_to_exclude | set(mentioned_ids)

    subscribers = (
        User.objects.filter(
            is_active=True,
            subgroup_subscriptions__subgroup_id=subgroup_id,
            subgroup_subscriptions__notify_replies=True,
        )
        .exclude(id__in=final_exclude)
        .exclude(id__in=ThreadMuteStatus.objects.filter(thread_id=thread_id).values("user_id"))
        .distinct()
    )
    if members_only:
        from apps.forum.models import SubgroupMembership, Thread

        member_ids = set(
            SubgroupMembership.objects.filter(subgroup_id=subgroup_id).values_list(
                "user_id", flat=True
            )
        )
        # Author of the thread is always allowed to receive replies.
        thread_author_id = (
            Thread.objects.filter(id=thread_id).values_list("author_id", flat=True).first()
        )
        if thread_author_id:
            member_ids.add(thread_author_id)
        subscribers = subscribers.filter(id__in=member_ids)

    count = notify_subgroup_activity(
        subscribers=subscribers,
        replier=replier,
        thread_title=thread_title,
        thread_id=thread_id,
        subgroup_name=subgroup_name,
        subgroup_slug=subgroup_slug,
        thread_slug=thread_slug,
        reply_content=reply_content,
        post_id=post_id,
    )
    logger.info("notify_subgroup_activity_task COMPLETED: %d notifications created", count)


@db_task(retries=1, retry_delay=60)
def notify_subgroup_activity_new_thread_task(
    author_id: int,
    thread_title: str,
    thread_id: int,
    subgroup_id: int,
    subgroup_name: str,
    subgroup_slug: str,
    thread_slug: str,
    initial_post_content: str,
    post_id: int,
    exclude_user_ids: list[int],
    members_only: bool = False,
) -> None:
    """Notify subgroup subscribers with notify_subgroup_activity about a new thread.

    This catches users who have subgroup_activity enabled but NOT forum_subscriptions —
    i.e., they won't receive NEW_THREAD but still want to know about activity.

    exclude_user_ids: author + effective mentioned users (who will receive MENTION)
    """
    logger.info(
        "notify_subgroup_activity_new_thread_task STARTED: author=%d thread='%s'",
        author_id,
        thread_title,
    )
    from apps.users.models import User

    from .services import notify_subgroup_activity

    try:
        author = User.objects.get(id=author_id)
    except User.DoesNotExist:
        logger.warning("notify_subgroup_activity_new_thread_task: Author %d not found", author_id)
        return

    from apps.notifications.models import NotificationPreference

    # Users who WILL receive NEW_THREAD (notify_forum_subscriptions=True or no prefs row).
    # Those with explicit False are NOT getting NEW_THREAD, so they should get SUBGROUP_ACTIVITY.
    users_with_prefs_off = set(
        NotificationPreference.objects.filter(
            notify_forum_subscriptions=False,
        ).values_list("user_id", flat=True)
    )
    all_users_with_prefs = set(NotificationPreference.objects.values_list("user_id", flat=True))
    # will_get_new_thread = has prefs with True, OR has no prefs at all (default True)
    will_get_new_thread = (all_users_with_prefs - users_with_prefs_off) | set(
        User.objects.exclude(pk__in=all_users_with_prefs).values_list("pk", flat=True)
    )

    final_exclude = set(exclude_user_ids) | will_get_new_thread

    subscribers = (
        User.objects.filter(
            is_active=True,
            subgroup_subscriptions__subgroup_id=subgroup_id,
            subgroup_subscriptions__notify_new_threads=True,
        )
        .exclude(id__in=final_exclude)
        .distinct()
    )
    if members_only:
        from apps.forum.models import SubgroupMembership

        member_ids = set(
            SubgroupMembership.objects.filter(subgroup_id=subgroup_id).values_list(
                "user_id", flat=True
            )
        )
        member_ids.add(author_id)
        subscribers = subscribers.filter(id__in=member_ids)

    count = notify_subgroup_activity(
        subscribers=subscribers,
        replier=author,
        thread_title=thread_title,
        thread_id=thread_id,
        subgroup_name=subgroup_name,
        subgroup_slug=subgroup_slug,
        thread_slug=thread_slug,
        reply_content=initial_post_content,
        post_id=post_id,
        title=f"Ny tråd: {thread_title}",
    )
    logger.info(
        "notify_subgroup_activity_new_thread_task COMPLETED: %d notifications created", count
    )


# ---------------------------------------------------------------------------
# Drive menu refresh
# ---------------------------------------------------------------------------


@db_task(retries=1, retry_delay=60)
def notify_subgroup_member_added_task(
    user_id: int,
    actor_id: int,
    subgroup_id: int,
    subgroup_name: str,
    subgroup_slug: str,
) -> None:
    """Notify a user that they were added to a subgroup."""
    from apps.users.models import User

    from .services import notify_subgroup_member_added

    try:
        user = User.objects.get(id=user_id)
        actor = User.objects.get(id=actor_id)
    except User.DoesNotExist:
        return
    notify_subgroup_member_added(
        user=user,
        actor=actor,
        subgroup_name=subgroup_name,
        subgroup_slug=subgroup_slug,
    )


@db_task(retries=1, retry_delay=60)
def notify_subgroup_member_removed_task(
    user_id: int,
    actor_id: int,
    subgroup_id: int,
    subgroup_name: str,
    subgroup_slug: str,
) -> None:
    """Notify a user that they were removed from a subgroup."""
    from apps.users.models import User

    from .services import notify_subgroup_member_removed

    try:
        user = User.objects.get(id=user_id)
        actor = User.objects.get(id=actor_id)
    except User.DoesNotExist:
        return
    notify_subgroup_member_removed(
        user=user,
        actor=actor,
        subgroup_name=subgroup_name,
        subgroup_slug=subgroup_slug,
    )


@db_task(retries=1, retry_delay=60)
def refresh_all_drive_menus_task() -> None:
    """Refresh all Google Drive menus in background."""
    from apps.food.services.drive_menu import DriveMenuService

    service = DriveMenuService()
    result = service.refresh_all_menus()
    logger.info("Drive menu refresh: %d updated, %d failed", result["updated"], result["failed"])
