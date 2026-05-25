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
    """Fan out a push notification to per-subscription tasks for the user."""
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

    result = send_push_notification(
        user=user,
        notification_type=notification_type,
        title=title,
        message=message,
        link=link,
    )
    logger.info(
        "send_push_task COMPLETED: user=%d type=%s enqueued=%d",
        user_id,
        notification_type,
        result.get("total", 0),
    )


class PushDeliveryError(Exception):
    """Raised when all retry attempts for a push delivery are exhausted.

    Distinct from TransientPushError so the Sentry filter can drop routine
    retry noise but still surface persistent delivery failures.
    """


# Exponential backoff between retries (seconds). PUSH_RETRY_DELAYS[i] is the
# wait BEFORE attempt i+2 (i.e. after the (i+1)-th failure). The first attempt
# has no preceding delay; with 4 retries we get 5 total attempts and wait at
# most 60+120+240+480 = ~15 minutes spread across them.
PUSH_RETRY_DELAYS = [60, 120, 240, 480]
PUSH_MAX_ATTEMPTS = len(PUSH_RETRY_DELAYS) + 1


@db_task(retries=PUSH_MAX_ATTEMPTS - 1, retry_delay=PUSH_RETRY_DELAYS[0], context=True)
def send_push_to_subscription_task(
    subscription_id: int,
    notification_type: str,
    title: str,
    message: str,
    link: str,
    task=None,
) -> None:
    """Send a push to one subscription. Retries transient failures with exponential backoff.

    Permanent failures (404/410 expired → sub deleted; 401/403 auth → logged) do not retry.
    """
    from .models import PushSubscription
    from .services import TransientPushError, send_push_to_subscription

    try:
        subscription = PushSubscription.objects.get(id=subscription_id)
    except PushSubscription.DoesNotExist:
        # Already deleted (e.g. expired on a previous attempt) — nothing to do.
        return

    from django.db import connection

    connection.close()  # Release DB connection before HTTP push calls

    try:
        send_push_to_subscription(
            subscription=subscription,
            notification_type=notification_type,
            title=title,
            message=message,
            link=link,
        )
    except TransientPushError as e:
        # Adjust retry_delay for the *next* attempt based on how many we've used.
        # task.retries at this point = retries REMAINING after this failure.
        if task is not None and task.retries > 0:
            attempts_used = PUSH_MAX_ATTEMPTS - 1 - task.retries  # 0 on first failure
            task.retry_delay = PUSH_RETRY_DELAYS[min(attempts_used, len(PUSH_RETRY_DELAYS) - 1)]
            logger.info(
                "Push retry scheduled: sub_id=%d type=%s remaining=%d delay=%ds",
                subscription_id,
                notification_type,
                task.retries,
                task.retry_delay,
            )
            raise
        # No retries left — surface as a distinct exception so Sentry captures it
        # (TransientPushError is filtered out as routine retry noise).
        raise PushDeliveryError(
            f"Push to subscription {subscription_id} failed after {PUSH_MAX_ATTEMPTS} attempts: {e}"
        ) from e


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

    from apps.forum.models import SubgroupMembership, SubgroupSubscription

    # Subscribers with notify_new_threads=True (existing recipients).
    subscriber_ids = set(
        SubgroupSubscription.objects.filter(
            subgroup_id=subgroup_id,
            notify_new_threads=True,
        ).values_list("user_id", flat=True)
    )
    # Members default to opted-in. Exclude only those with an explicit
    # subscription saying notify_new_threads=False — a deliberate opt-out.
    opted_out_ids = set(
        SubgroupSubscription.objects.filter(
            subgroup_id=subgroup_id,
            notify_new_threads=False,
        ).values_list("user_id", flat=True)
    )
    member_ids = set(
        SubgroupMembership.objects.filter(subgroup_id=subgroup_id).values_list("user_id", flat=True)
    )
    recipient_ids = subscriber_ids | (member_ids - opted_out_ids)

    if members_only:
        # Restrict to (current members of subgroup ∪ {author}).
        recipient_ids &= member_ids
        recipient_ids.add(author_id)
    if exclude_user_ids:
        recipient_ids.difference_update(exclude_user_ids)

    subscribers = User.objects.filter(id__in=recipient_ids, is_active=True)
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

    from apps.forum.models import SubgroupMembership, SubgroupSubscription

    subscriber_ids = set(
        SubgroupSubscription.objects.filter(
            subgroup_id=subgroup_id,
            notify_replies=True,
        ).values_list("user_id", flat=True)
    )
    # Members default to opted-in for replies; only an explicit subscription
    # row with notify_replies=False excludes them.
    opted_out_ids = set(
        SubgroupSubscription.objects.filter(
            subgroup_id=subgroup_id,
            notify_replies=False,
        ).values_list("user_id", flat=True)
    )
    member_ids = set(
        SubgroupMembership.objects.filter(subgroup_id=subgroup_id).values_list("user_id", flat=True)
    )
    recipient_ids = subscriber_ids | (member_ids - opted_out_ids)

    muted_ids = set(
        ThreadMuteStatus.objects.filter(thread_id=thread_id).values_list("user_id", flat=True)
    )
    recipient_ids -= final_exclude
    recipient_ids -= muted_ids

    if members_only:
        from apps.forum.models import Thread

        # Author of the thread is always allowed to receive replies.
        thread_author_id = (
            Thread.objects.filter(id=thread_id).values_list("author_id", flat=True).first()
        )
        allowed = set(member_ids)
        if thread_author_id:
            allowed.add(thread_author_id)
        recipient_ids &= allowed

    subscribers = User.objects.filter(id__in=recipient_ids, is_active=True)

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

    from apps.forum.models import SubgroupMembership, SubgroupSubscription

    subscriber_ids = set(
        SubgroupSubscription.objects.filter(
            subgroup_id=subgroup_id,
            notify_new_threads=True,
        ).values_list("user_id", flat=True)
    )
    opted_out_ids = set(
        SubgroupSubscription.objects.filter(
            subgroup_id=subgroup_id,
            notify_new_threads=False,
        ).values_list("user_id", flat=True)
    )
    member_ids = set(
        SubgroupMembership.objects.filter(subgroup_id=subgroup_id).values_list("user_id", flat=True)
    )
    recipient_ids = subscriber_ids | (member_ids - opted_out_ids)
    recipient_ids -= final_exclude

    if members_only:
        allowed = set(member_ids)
        allowed.add(author_id)
        recipient_ids &= allowed

    subscribers = User.objects.filter(id__in=recipient_ids, is_active=True)

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
def notify_post_edited_by_admin_task(
    post_author_id: int,
    editor_id: int,
    thread_title: str,
    thread_id: int,
    subgroup_slug: str,
    thread_slug: str,
    post_id: int,
) -> None:
    """Notify post author when an admin edits their content."""
    logger.info(
        "notify_post_edited_by_admin_task STARTED: author=%d editor=%d",
        post_author_id,
        editor_id,
    )
    from apps.users.models import User

    from .services import notify_post_edited_by_admin

    try:
        post_author = User.objects.get(id=post_author_id)
    except User.DoesNotExist:
        logger.warning("notify_post_edited_by_admin_task: Author %d not found", post_author_id)
        return

    try:
        editor = User.objects.get(id=editor_id)
    except User.DoesNotExist:
        logger.warning("notify_post_edited_by_admin_task: Editor %d not found", editor_id)
        return

    notify_post_edited_by_admin(
        post_author=post_author,
        editor=editor,
        thread_title=thread_title,
        thread_id=thread_id,
        subgroup_slug=subgroup_slug,
        thread_slug=thread_slug,
        post_id=post_id,
    )
    logger.info(
        "notify_post_edited_by_admin_task COMPLETED: author=%d editor=%d",
        post_author_id,
        editor_id,
    )


@db_task(retries=1, retry_delay=60)
def notify_event_edited_by_admin_task(
    event_creator_id: int,
    editor_id: int,
    event_title: str,
    event_slug: str,
) -> None:
    """Notify event creator when an admin edits their event."""
    logger.info(
        "notify_event_edited_by_admin_task STARTED: creator=%d editor=%d",
        event_creator_id,
        editor_id,
    )
    from apps.users.models import User

    from .services import notify_event_edited_by_admin

    try:
        event_creator = User.objects.get(id=event_creator_id)
    except User.DoesNotExist:
        logger.warning("notify_event_edited_by_admin_task: Creator %d not found", event_creator_id)
        return

    try:
        editor = User.objects.get(id=editor_id)
    except User.DoesNotExist:
        logger.warning("notify_event_edited_by_admin_task: Editor %d not found", editor_id)
        return

    notify_event_edited_by_admin(
        event_creator=event_creator,
        editor=editor,
        event_title=event_title,
        event_slug=event_slug,
    )
    logger.info(
        "notify_event_edited_by_admin_task COMPLETED: creator=%d editor=%d",
        event_creator_id,
        editor_id,
    )


@db_task(retries=1, retry_delay=60)
def notify_announcement_edited_by_admin_task(
    announcement_author_id: int,
    editor_id: int,
    announcement_title: str,
    announcement_id: int,
) -> None:
    """Notify announcement author when an admin edits their announcement."""
    logger.info(
        "notify_announcement_edited_by_admin_task STARTED: author=%d editor=%d",
        announcement_author_id,
        editor_id,
    )
    from apps.users.models import User

    from .services import notify_announcement_edited_by_admin

    try:
        announcement_author = User.objects.get(id=announcement_author_id)
    except User.DoesNotExist:
        logger.warning(
            "notify_announcement_edited_by_admin_task: Author %d not found",
            announcement_author_id,
        )
        return

    try:
        editor = User.objects.get(id=editor_id)
    except User.DoesNotExist:
        logger.warning("notify_announcement_edited_by_admin_task: Editor %d not found", editor_id)
        return

    notify_announcement_edited_by_admin(
        announcement_author=announcement_author,
        editor=editor,
        announcement_title=announcement_title,
        announcement_id=announcement_id,
    )
    logger.info(
        "notify_announcement_edited_by_admin_task COMPLETED: author=%d editor=%d",
        announcement_author_id,
        editor_id,
    )


@db_task(retries=1, retry_delay=60)
def refresh_all_drive_menus_task() -> None:
    """Refresh all Google Drive menus in background."""
    from apps.food.services.drive_menu import DriveMenuService

    service = DriveMenuService()
    result = service.refresh_all_menus()
    logger.info("Drive menu refresh: %d updated, %d failed", result["updated"], result["failed"])
