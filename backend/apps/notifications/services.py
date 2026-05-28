"""
Notification services for creating notifications.
"""

import json
import logging
import re
import time
import zoneinfo
from collections.abc import Sequence
from typing import Any
from urllib.parse import urlparse

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.db import transaction
from django.db.models import QuerySet

from apps.users.models import User

from .models import Notification, NotificationPreference, NotificationType, PushSubscription

logger = logging.getLogger(__name__)

# Copenhagen timezone for formatting event times in notifications.
_CPH_TZ = zoneinfo.ZoneInfo("Europe/Copenhagen")

# Notification types that support in-app aggregation (collapse multiple events into one notification).
AGGREGATABLE_TYPES = frozenset(
    {
        NotificationType.THREAD_REPLY,
        NotificationType.POST_REPLY,
        NotificationType.POST_REACTION,
        NotificationType.MESSAGE_REACTION,
        NotificationType.NEW_THREAD,
        NotificationType.SUBGROUP_ACTIVITY,
    }
)

# Single source of truth for how forum-activity notifications rank against each other.
# One physical activity (a reply, a new thread) can match several of these types for the same
# user. The in-app row is shown for whichever type the user enabled; on each channel
# (email/push) we keep only the HIGHEST-priority type, so a user never gets the same activity
# twice on one channel. Call sites only declare which types a user is eligible for (via
# `superseded_by`); this ordering — not the call sites — decides what actually supersedes what.
# Types in the same tuple share a tier (they map to the same preference field).
_FORUM_ACTIVITY_TIERS: tuple[tuple[str, ...], ...] = (
    (NotificationType.MENTION,),
    (NotificationType.THREAD_REPLY, NotificationType.POST_REPLY),
    (NotificationType.NEW_THREAD,),
    (NotificationType.SUBGROUP_ACTIVITY,),
)


def _priority_rank(notification_type: str) -> int:
    """Priority rank of a forum-activity type — lower means higher priority.

    Types not in `_FORUM_ACTIVITY_TIERS` rank lowest, so they can never supersede anything.
    """
    for rank, tier in enumerate(_FORUM_ACTIVITY_TIERS):
        if notification_type in tier:
            return rank
    return len(_FORUM_ACTIVITY_TIERS)


def _make_aggregate_title(notification_type: str, count: int, existing_title: str) -> str:
    """Return an updated notification title reflecting the aggregated count."""
    if notification_type == NotificationType.THREAD_REPLY:
        # Title is the thread name; keep it and add count
        return f"{existing_title} ({count} nye svar)"
    if notification_type == NotificationType.POST_REPLY:
        return f"{existing_title} ({count} nye svar)"
    if notification_type == NotificationType.POST_REACTION:
        return f"{count} reaktioner på dit indlæg"
    if notification_type == NotificationType.MESSAGE_REACTION:
        return f"{count} reaktioner på din besked"
    if notification_type == NotificationType.SUBGROUP_ACTIVITY:
        # Title is the thread name; keep it and add count
        return f"{existing_title} ({count} nye svar)"
    return existing_title


# TTL (seconds) per notification type — how long the push service should hold undelivered messages.
PUSH_TTL: dict[str, int] = {
    NotificationType.EVENT_REMINDER: 2 * 3600,  # 2 hours
    NotificationType.EVENT_CANCELLED: 12 * 3600,  # 12 hours
    NotificationType.NEW_MESSAGE: 24 * 3600,  # 24 hours
    NotificationType.MESSAGE_REACTION: 24 * 3600,  # 24 hours
    NotificationType.MENTION: 24 * 3600,  # 24 hours
}
PUSH_TTL_DEFAULT = 48 * 3600  # 48 hours


def send_notification_to_websocket(notification: Notification) -> None:
    """Send notification to user via WebSocket."""
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return

    notification_data = {
        "id": notification.id,
        "notification_type": notification.notification_type,
        "notification_type_display": notification.get_notification_type_display(),
        "title": notification.title,
        "message": notification.message,
        "link": notification.link,
        "is_read": notification.is_read,
        "aggregate_count": notification.aggregate_count,
        "related_user": None,
        "created_at": notification.created_at.isoformat(),
        "updated_at": notification.updated_at.isoformat(),
    }

    if notification.related_user:
        notification_data["related_user"] = {
            "id": notification.related_user.id,
            "first_name": notification.related_user.first_name,
            "last_name": notification.related_user.last_name,
            "profile_picture": notification.related_user.avatar_url,
        }

    async_to_sync(channel_layer.group_send)(
        f"user_{notification.user.id}",
        {
            "type": "new_notification",
            "notification": notification_data,
        },
    )


def get_user_preference(user: User, notification_type: NotificationType) -> bool:
    """Check if user wants to receive a specific notification type (in-app)."""
    try:
        prefs = user.notification_preferences
    except NotificationPreference.DoesNotExist:
        # Default to True if no preferences set
        return True

    preference_map = {
        NotificationType.NEW_ANNOUNCEMENT: prefs.notify_announcements,
        NotificationType.ANNOUNCEMENT_UPDATED: prefs.notify_announcement_updates,
        NotificationType.NEW_THREAD: prefs.notify_forum_subscriptions,
        NotificationType.THREAD_REPLY: prefs.notify_thread_replies,
        NotificationType.POST_REPLY: prefs.notify_thread_replies,
        NotificationType.SUBGROUP_ACTIVITY: prefs.notify_subgroup_activity,
        NotificationType.POST_REACTION: prefs.notify_post_reactions,
        NotificationType.MESSAGE_REACTION: prefs.notify_message_reactions,
        NotificationType.EVENT_CREATED: prefs.notify_events,
        NotificationType.EVENT_UPDATED: prefs.notify_events,
        NotificationType.EVENT_CANCELLED: prefs.notify_events,
        NotificationType.EVENT_REMINDER: prefs.notify_event_reminders,
        NotificationType.FOOD_TICKET: prefs.notify_food_tickets,
        NotificationType.FOOD_TEAM_REMINDER: prefs.notify_food_team_reminder,
        NotificationType.FOOD_TEAM_TAKEAWAY_READY: prefs.notify_food_takeaway_ready,
        NotificationType.FOOD_TEAM_LEFTOVERS_READY: prefs.notify_food_leftovers_ready,
        NotificationType.FOOD_TEAM_SWAP_REQUEST: prefs.notify_food_swap_request,
        NotificationType.MENTION: prefs.notify_mentions,
        # Subgroup membership notifications are not user-configurable: always
        # delivered in-app so users know when their access changes.
        NotificationType.SUBGROUP_MEMBER_ADDED: True,
        NotificationType.SUBGROUP_MEMBER_REMOVED: True,
        # Admin-edit notifications are always delivered.
        NotificationType.POST_EDITED_BY_ADMIN: True,
        NotificationType.EVENT_EDITED_BY_ADMIN: True,
        NotificationType.ANNOUNCEMENT_EDITED_BY_ADMIN: True,
    }

    return preference_map.get(notification_type, True)


def get_user_push_preference(user: User, notification_type: NotificationType) -> bool:
    """Check if user wants to receive push notifications for a specific type."""
    try:
        prefs = user.notification_preferences
    except NotificationPreference.DoesNotExist:
        # Default to True if no preferences set
        return True

    preference_map = {
        NotificationType.NEW_MESSAGE: prefs.push_messages,
        NotificationType.NEW_ANNOUNCEMENT: prefs.push_announcements,
        NotificationType.ANNOUNCEMENT_UPDATED: prefs.push_announcement_updates,
        NotificationType.NEW_THREAD: prefs.push_forum_subscriptions,
        NotificationType.THREAD_REPLY: prefs.push_thread_replies,
        NotificationType.POST_REPLY: prefs.push_thread_replies,
        NotificationType.SUBGROUP_ACTIVITY: prefs.push_subgroup_activity,
        NotificationType.POST_REACTION: prefs.push_post_reactions,
        NotificationType.MESSAGE_REACTION: prefs.push_messages,
        NotificationType.EVENT_CREATED: prefs.push_events,
        NotificationType.EVENT_UPDATED: prefs.push_events,
        NotificationType.EVENT_CANCELLED: prefs.push_events,
        NotificationType.EVENT_REMINDER: prefs.push_event_reminders,
        NotificationType.FOOD_TICKET: prefs.push_food_tickets,
        NotificationType.FOOD_TEAM_REMINDER: prefs.push_food_team_reminder,
        NotificationType.FOOD_TEAM_TAKEAWAY_READY: prefs.push_food_takeaway_ready,
        NotificationType.FOOD_TEAM_LEFTOVERS_READY: prefs.push_food_leftovers_ready,
        NotificationType.FOOD_TEAM_SWAP_REQUEST: prefs.push_food_swap_request,
        NotificationType.MENTION: prefs.push_mentions,
    }

    # Subgroup membership pushes piggyback on whatever push channels the user
    # already has enabled — if they've opted into any push at all, they get
    # pushed about being added to / removed from a group.
    if notification_type in (
        NotificationType.SUBGROUP_MEMBER_ADDED,
        NotificationType.SUBGROUP_MEMBER_REMOVED,
    ):
        return any(
            (
                prefs.push_messages,
                prefs.push_announcements,
                prefs.push_announcement_updates,
                prefs.push_forum_subscriptions,
                prefs.push_thread_replies,
                prefs.push_subgroup_activity,
                prefs.push_post_reactions,
                prefs.push_events,
                prefs.push_event_reminders,
                prefs.push_food_tickets,
                prefs.push_food_team_reminder,
                prefs.push_food_takeaway_ready,
                prefs.push_food_leftovers_ready,
                prefs.push_food_swap_request,
                prefs.push_mentions,
            )
        )

    return preference_map.get(notification_type, True)


class TransientPushError(Exception):
    """Raised when a push delivery fails for a reason that may succeed on retry.

    Triggers Huey retry with exponential backoff. Permanent failures (expired
    subscription, bad VAPID credentials) raise nothing — they are logged and
    the subscription handled (deleted on 404/410).
    """


def _classify_webpush_status(status_code: int | None) -> str:
    """Return one of: 'expired', 'auth_failed', 'transient', 'permanent'."""
    if status_code in (404, 410):
        return "expired"
    if status_code in (401, 403):
        # Bad VAPID config — retrying won't help.
        return "auth_failed"
    if status_code is not None and 400 <= status_code < 500 and status_code != 429:
        # Other 4xx (e.g. 400 invalid payload, 413 too large) — won't help to retry.
        return "permanent"
    # 5xx, 429, unknown / no status (network errors) — retry.
    return "transient"


def send_push_to_subscription(
    subscription: PushSubscription,
    notification_type: str,
    title: str,
    message: str,
    link: str,
) -> None:
    """Send a push to one subscription. Raises TransientPushError on retryable failures.

    Permanent failures (expired sub deleted; auth/permanent 4xx logged) return None.
    """
    vapid_private_key = getattr(settings, "VAPID_PRIVATE_KEY", None)
    vapid_claims = getattr(settings, "VAPID_CLAIMS", None)
    if not vapid_private_key or not vapid_claims:
        return

    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        logger.warning("pywebpush not installed, skipping push notifications")
        return

    parsed = urlparse(str(subscription.endpoint))
    log_ctx = {
        "sub_id": subscription.id,
        "user_id": subscription.user_id,
        "endpoint": parsed.netloc,
        "type": notification_type,
    }
    payload = json.dumps(
        {
            "title": title,
            "body": message,
            "icon": "/pwa-192x192.png",
            "badge": "/pwa-192x192.png",
            "data": {"url": link, "notification_type": notification_type},
        }
    )
    ttl = PUSH_TTL.get(notification_type, PUSH_TTL_DEFAULT)

    try:
        # Apple requires aud to be the push service origin.
        now = int(time.time())
        claims = vapid_claims.copy()
        claims["aud"] = f"{parsed.scheme}://{parsed.netloc}"
        claims["iat"] = now
        claims["exp"] = now + 43200  # 12 hours (Apple rejects tokens near the 24h limit)

        response = webpush(
            subscription_info=subscription.get_subscription_info(),
            data=payload,
            vapid_private_key=vapid_private_key,
            vapid_claims=claims,
            ttl=ttl,
        )
        logger.info(
            "Push sent: sub_id=%(sub_id)s user=%(user_id)s endpoint=%(endpoint)s "
            "type=%(type)s status=%(status)s ttl=%(ttl)s",
            {"status": response.status_code, "ttl": ttl, **log_ctx},
        )
        return
    except WebPushException as e:
        status_code = getattr(e.response, "status_code", None)
        if status_code is None:
            m = re.search(r"Push failed: (\d+)", str(e))
            if m:
                status_code = int(m.group(1))
        kind = _classify_webpush_status(status_code)
        if kind == "expired":
            logger.warning(
                "Push subscription expired (%(status)s): sub_id=%(sub_id)s "
                "user=%(user_id)s endpoint=%(endpoint)s type=%(type)s",
                {"status": status_code, **log_ctx},
            )
            PushSubscription.objects.filter(id=subscription.id).delete()
            return
        if kind == "auth_failed":
            logger.error(
                "VAPID auth rejected (%(status)s): sub_id=%(sub_id)s user=%(user_id)s "
                "endpoint=%(endpoint)s — check VAPID keys config. %(error)s",
                {"status": status_code, "error": e, **log_ctx},
            )
            return
        if kind == "permanent":
            logger.error(
                "Push permanently rejected (%(status)s): sub_id=%(sub_id)s "
                "user=%(user_id)s endpoint=%(endpoint)s type=%(type)s error=%(error)s",
                {"status": status_code, "error": e, **log_ctx},
            )
            return
        # transient — log and re-raise so Huey retries with backoff
        logger.warning(
            "Push transient failure (%(status)s) — will retry: sub_id=%(sub_id)s "
            "user=%(user_id)s endpoint=%(endpoint)s type=%(type)s error=%(error)s",
            {"status": status_code, "error": e, **log_ctx},
        )
        raise TransientPushError(str(e)) from e
    except Exception as e:
        # Network errors etc. — assume transient and retry.
        logger.warning(
            "Push unexpected error — will retry: sub_id=%(sub_id)s user=%(user_id)s "
            "endpoint=%(endpoint)s type=%(type)s error=%(error)s",
            {"error": e, **log_ctx},
        )
        raise TransientPushError(str(e)) from e


def send_push_notification(
    user: User,
    notification_type: NotificationType,
    title: str,
    message: str,
    link: str = "",
) -> dict:
    """Fan out a push notification to all of the user's subscribed devices.

    Each subscription is sent in its own retried Huey task so transient
    failures on one device don't affect the others, and so a network blip to
    one push service can be retried independently with exponential backoff.

    Returns a summary dict (mostly for tests / callers): total, enqueued_ids.
    """
    vapid_private_key = getattr(settings, "VAPID_PRIVATE_KEY", None)
    vapid_claims = getattr(settings, "VAPID_CLAIMS", None)

    empty_result: dict = {"total": 0, "enqueued_ids": []}

    if not vapid_private_key or not vapid_claims:
        logger.debug("Push notifications not configured, skipping")
        return empty_result

    if not get_user_push_preference(user, notification_type):
        logger.debug(f"User {user.id} has push disabled for {notification_type}")
        return empty_result

    subscription_ids = list(PushSubscription.objects.filter(user=user).values_list("id", flat=True))
    if not subscription_ids:
        logger.debug(f"User {user.id} has no push subscriptions")
        return empty_result

    from apps.notifications.tasks import send_push_to_subscription_task

    for sub_id in subscription_ids:
        send_push_to_subscription_task(sub_id, notification_type, title, message, link)

    return {"total": len(subscription_ids), "enqueued_ids": subscription_ids}


def create_notification(
    user: User,
    notification_type: NotificationType,
    title: str,
    message: str,
    link: str = "",
    related_user: User | None = None,
    check_preferences: bool = True,
    html_content: str | None = None,
    group_key: str = "",
    superseded_by: Sequence[str] = (),
) -> Notification | None:
    """Create a notification for a user.

    Args:
        user: The user to notify
        notification_type: Type of notification
        title: Notification title
        message: Notification message
        link: Optional link to related content
        related_user: Optional user who triggered the notification
        check_preferences: Whether to check user preferences before creating
        html_content: Optional rich HTML content for email (announcements, posts, etc.)
        group_key: Optional key for aggregating related notifications (e.g. thread URL).
            When set and a matching unread notification exists, it is updated in-place
            instead of creating a new one.
        superseded_by: Other notification types this user is eligible for from the SAME
            activity (e.g. a participant who falls back to SUBGROUP_ACTIVITY in-app still gets
            THREAD_REPLY by email/push). Only entries that outrank this notification per
            _FORUM_ACTIVITY_TIERS actually count; for those, the email/push channel is skipped
            here whenever the user already receives the higher type on that channel — keeping
            one notification per channel without double-sending. The in-app row is never
            skipped (the fall-through is the whole point of showing it in-app).

    Returns:
        The created (or updated) notification, or None if user opted out of in-app notifications
    """
    # A higher-priority type covers this activity on whichever channels the user has it
    # enabled — skip those channels here. (should_send_email / get_user_push_preference both
    # read the same cached user.notification_preferences, so this adds no extra queries.)
    # Only types that genuinely outrank this one (per _FORUM_ACTIVITY_TIERS) can suppress a
    # channel, so a mis-declared superseded_by entry can never silently drop a notification.
    suppress_email = suppress_push = False
    if superseded_by:
        from .email_service import should_send_email

        rank = _priority_rank(notification_type)
        superseding = [t for t in superseded_by if _priority_rank(t) < rank]
        suppress_email = any(should_send_email(user, t) for t in superseding)
        suppress_push = any(get_user_push_preference(user, t) for t in superseding)

    notification = None

    # Skip in-app notifications for messages — the unread message count handles that
    skip_in_app = notification_type == NotificationType.NEW_MESSAGE

    # Create in-app notification if user wants it (or if check_preferences is False)
    if not skip_in_app and (not check_preferences or get_user_preference(user, notification_type)):
        # Try to aggregate into an existing unread notification first
        if notification_type in AGGREGATABLE_TYPES and group_key:
            try:
                existing = Notification.objects.get(
                    user=user,
                    notification_type=notification_type,
                    group_key=group_key,
                    is_read=False,
                )
                new_count = existing.aggregate_count + 1
                existing.aggregate_count = new_count
                existing.title = _make_aggregate_title(notification_type, new_count, existing.title)
                existing.message = message  # Show latest reply/reaction preview
                existing.link = link  # Point to the latest post/item
                existing.related_user = related_user  # Show the latest actor
                existing.is_read = False
                existing.save()  # updated_at refreshes → notification floats to top
                notification = existing
            except Notification.DoesNotExist:
                pass

        if notification is None:
            notification = Notification.objects.create(
                user=user,
                notification_type=notification_type,
                title=title,
                message=message,
                link=link,
                related_user=related_user,
                group_key=group_key,
            )

    # Defer side effects (WebSocket, email, push) until the transaction commits.
    # If no transaction is active, on_commit runs the callback immediately.
    _notification_id = notification.id if notification else None
    _user_id = user.id
    _related_user_id = related_user.id if related_user else None

    def _dispatch_side_effects() -> None:
        if _notification_id is not None:
            try:
                n = Notification.objects.get(id=_notification_id)
                send_notification_to_websocket(n)
            except Notification.DoesNotExist:
                pass
            except Exception:
                logger.exception("Failed to send WebSocket notification to user %s", _user_id)

        from apps.notifications.tasks import send_email_task, send_push_task

        logger.info(
            "Enqueuing email+push tasks for user=%d type=%s title='%s' "
            "(suppress_email=%s suppress_push=%s)",
            _user_id,
            notification_type,
            title,
            suppress_email,
            suppress_push,
        )
        email_result = None
        if not suppress_email:
            email_result = send_email_task(
                _user_id,
                notification_type,
                title,
                message,
                link,
                _related_user_id,
                html_content,
            )
        push_result = None
        if not suppress_push:
            push_result = send_push_task(
                _user_id,
                notification_type,
                title,
                message,
                link,
            )
        logger.info(
            "Enqueued tasks for user=%d: email=%s push=%s",
            _user_id,
            email_result,
            push_result,
        )

    transaction.on_commit(_dispatch_side_effects)

    return notification


def notify_new_message(
    recipient: User,
    sender: User,
    message_content: str,
    conversation_id: int,
    message_id: int = 0,
) -> Notification | None:
    """Create notification for a new message."""
    # Preview for in-app notification
    preview = message_content[:100] + ("..." if len(message_content) > 100 else "")
    link = f"/beskeder/{conversation_id}"
    if message_id:
        link += f"#msg-{message_id}"
    return create_notification(
        user=recipient,
        notification_type=NotificationType.NEW_MESSAGE,
        title=f"Ny besked fra {sender.first_name}",
        message=preview,
        link=link,
        related_user=sender,
        html_content=f"<p>{message_content}</p>",  # Full message in email
    )


def notify_new_announcement(
    recipients: QuerySet[User],
    author: User,
    announcement_title: str,
    announcement_id: int,
    announcement_content: str = "",
) -> int:
    """Create notifications for a new announcement.

    Args:
        recipients: Users to notify
        author: User who created the announcement
        announcement_title: Title of the announcement
        announcement_id: ID of the announcement
        announcement_content: Full HTML content of the announcement

    Returns the count of notifications created.
    """
    # No outer transaction: each create_notification commits independently so
    # the per-user write lock is released between iterations and concurrent
    # request writers don't pile up on busy_timeout.
    count = 0
    for user in recipients.exclude(id=author.id):
        notification = create_notification(
            user=user,
            notification_type=NotificationType.NEW_ANNOUNCEMENT,
            title=announcement_title,
            message=f"{author.first_name} oprettede et nyt opslag",
            link=f"/opslag#announcement-{announcement_id}",
            related_user=author,
            html_content=f"<h3>{announcement_title}</h3>{announcement_content}"
            if announcement_content
            else None,
        )
        if notification:
            count += 1
    return count


def notify_new_thread(
    subscribers: QuerySet[User],
    author: User,
    thread_title: str,
    thread_id: int,
    subgroup_name: str,
    subgroup_slug: str,
    thread_slug: str,
    initial_post_content: str = "",
    superseded_by_map: dict[int, Sequence[str]] | None = None,
) -> int:
    """Create notifications for a new thread in a subgroup.

    Args:
        subscribers: Users subscribed to the subgroup
        author: User who created the thread
        thread_title: Title of the thread
        thread_id: ID of the thread
        subgroup_name: Name of the subgroup
        subgroup_slug: Slug of the subgroup for URL
        thread_slug: Slug of the thread for URL
        initial_post_content: Full HTML content of the initial post
        superseded_by_map: {user_id: higher-priority types they already get for this thread}.
            Those channels are skipped per user. See create_notification.

    Returns the count of notifications created.
    """
    superseded_by_map = superseded_by_map or {}

    thread_link = f"/forum/{subgroup_slug}/traad/{thread_slug}"

    count = 0
    for user in subscribers.exclude(id=author.id):
        notification = create_notification(
            user=user,
            notification_type=NotificationType.NEW_THREAD,
            title=f"{thread_title} ({subgroup_name})",
            message=f"{author.first_name} oprettede en ny tråd",
            link=thread_link,
            related_user=author,
            html_content=f"<h3>{thread_title}</h3>{initial_post_content}"
            if initial_post_content
            else None,
            superseded_by=superseded_by_map.get(user.id, ()),
        )
        if notification:
            count += 1
    return count


def notify_thread_reply(
    thread_author: User,
    replier: User,
    thread_title: str,
    thread_id: int,
    subgroup_slug: str,
    thread_slug: str,
    reply_content: str,
    post_id: int = 0,
    superseded_by: Sequence[str] = (),
) -> Notification | None:
    """Create notification for a reply to user's thread.

    Args:
        thread_author: The thread owner to notify
        replier: User who replied
        thread_title: Title of the thread
        thread_id: ID of the thread
        subgroup_slug: Slug of the subgroup for URL
        thread_slug: Slug of the thread for URL
        reply_content: Full HTML content of the reply
        post_id: ID of the reply post (for scroll-to link)
        superseded_by: higher-priority types (e.g. MENTION) the user already gets for this
            activity — those channels are skipped here. See create_notification.
    """
    if thread_author.id == replier.id:
        return None

    from apps.forum.models import ThreadMuteStatus

    if ThreadMuteStatus.objects.filter(user=thread_author, thread_id=thread_id).exists():
        return None

    # Create preview for in-app notification (strip HTML for preview)
    from django.utils.html import strip_tags

    plain_text = strip_tags(reply_content)
    preview = plain_text[:80] + "..." if len(plain_text) > 80 else plain_text

    from apps.forum.models import Thread as ForumThread

    try:
        event_slug = ForumThread.objects.get(id=thread_id).event.slug
        base_link = f"/kalender/{event_slug}"
    except (ForumThread.DoesNotExist, AttributeError):
        base_link = f"/forum/{subgroup_slug}/traad/{thread_slug}"

    link = base_link + (f"#post-{post_id}" if post_id else "")

    return create_notification(
        user=thread_author,
        notification_type=NotificationType.THREAD_REPLY,
        title=thread_title,
        message=f"{replier.first_name}: {preview}",
        link=link,
        related_user=replier,
        html_content=f"<p><strong>I tråden: {thread_title}</strong></p>{reply_content}",
        group_key=base_link,  # Aggregate all replies to same thread
        superseded_by=superseded_by,
    )


def notify_post_reply(
    post_author: User,
    replier: User,
    thread_title: str,
    thread_id: int,
    subgroup_slug: str,
    thread_slug: str,
    reply_content: str,
    post_id: int = 0,
    superseded_by: Sequence[str] = (),
) -> Notification | None:
    """Create notification for a reply after user's post.

    Args:
        post_author: User who posted previously in the thread
        replier: User who replied
        thread_title: Title of the thread
        thread_id: ID of the thread
        subgroup_slug: Slug of the subgroup for URL
        thread_slug: Slug of the thread for URL
        reply_content: Full HTML content of the reply
        post_id: ID of the reply post (for scroll-to link)
        superseded_by: higher-priority types (e.g. MENTION) the user already gets for this
            activity — those channels are skipped here. See create_notification.
    """
    if post_author.id == replier.id:
        return None

    from apps.forum.models import ThreadMuteStatus

    if ThreadMuteStatus.objects.filter(user=post_author, thread_id=thread_id).exists():
        return None

    # Create preview for in-app notification (strip HTML for preview)
    from django.utils.html import strip_tags

    plain_text = strip_tags(reply_content)
    preview = plain_text[:80] + "..." if len(plain_text) > 80 else plain_text

    from apps.forum.models import Thread as ForumThread

    try:
        event_slug = ForumThread.objects.get(id=thread_id).event.slug
        base_link = f"/kalender/{event_slug}"
    except (ForumThread.DoesNotExist, AttributeError):
        base_link = f"/forum/{subgroup_slug}/traad/{thread_slug}"

    link = base_link + (f"#post-{post_id}" if post_id else "")

    return create_notification(
        user=post_author,
        notification_type=NotificationType.POST_REPLY,
        title=thread_title,
        message=f"{replier.first_name}: {preview}",
        link=link,
        related_user=replier,
        html_content=f"<p><strong>I tråden: {thread_title}</strong></p>{reply_content}",
        group_key=base_link,  # Aggregate all replies to same thread
        superseded_by=superseded_by,
    )


def notify_food_ticket_available(
    recipients: QuerySet[User],
    owner: User,
    ticket_date: str,
    ticket_id: int,
    portions: int,
) -> int:
    """Create notifications for a new food ticket.

    Returns the count of notifications created.
    """
    count = 0
    for user in recipients.exclude(id=owner.id):
        notification = create_notification(
            user=user,
            notification_type=NotificationType.FOOD_TICKET,
            title="Madbillet tilgængelig",
            message=f"{owner.first_name} tilbyder {portions} portion(er) den {ticket_date}",
            link="/mad/billetter",
            related_user=owner,
        )
        if notification:
            count += 1
    return count


def notify_ticket_claimed(
    owner: User,
    claimer: User,
    ticket_date: str,
) -> Notification | None:
    """Notify ticket owner that their ticket was claimed."""
    return create_notification(
        user=owner,
        notification_type=NotificationType.FOOD_TICKET,
        title="Din madbillet blev taget",
        message=f"{claimer.first_name} tog din billet til {ticket_date}",
        link="/mad/billetter",
        related_user=claimer,
        check_preferences=False,  # Always notify owner
    )


def notify_food_team_reminder(user: User, date_iso: str) -> Notification | None:
    """Remind a user that they have a cooking shift the next day.

    date_iso is an ISO date string (YYYY-MM-DD) for the cooking day.
    """
    import datetime as _dt

    from apps.food.constants import DAY_NAMES

    cooking_date = _dt.date.fromisoformat(date_iso)
    date_label = f"{DAY_NAMES[cooking_date.weekday()]} {cooking_date.day}/{cooking_date.month}"

    return create_notification(
        user=user,
        notification_type=NotificationType.FOOD_TEAM_REMINDER,
        title="Du har madhold i morgen",
        message=f"Du skal lave mad {date_label}",
        link="/madhold/mine-hold",
    )


def notify_food_swap_request(
    user: User,
    requester_name: str,
    date_label: str,
    link: str,
    related_user: User | None = None,
) -> Notification | None:
    """Notify a candidate that someone wants to swap their cooking day."""
    return create_notification(
        user=user,
        notification_type=NotificationType.FOOD_TEAM_SWAP_REQUEST,
        title="Bytteanmodning til madhold",
        message=f"{requester_name} vil gerne bytte sin maddag {date_label}",
        link=link,
        related_user=related_user,
    )


def _get_event_recipients(
    event: Any,
    exclude_user_id: int,
    *,
    rsvp_statuses: list[str] | None = None,
) -> QuerySet[User]:
    """Return the recipients for an event notification.

    Priority chain:
    1. If the event has RSVP enabled, return users matching *rsvp_statuses*.
    2. Else if the event belongs to a subgroup, return subgroup subscribers.
    3. Else return all active users.

    The *exclude_user_id* (typically the actor) is always excluded.
    """
    from apps.events.models import EventAttendance

    if event.rsvp_enabled and rsvp_statuses:
        attendee_user_ids = EventAttendance.objects.filter(
            event=event,
            user__isnull=False,
            status__in=rsvp_statuses,
        ).values_list("user_id", flat=True)
        return User.objects.filter(id__in=attendee_user_ids, is_active=True).exclude(
            id=exclude_user_id
        )

    if event.subgroup_id:
        from apps.forum.models import Subgroup, SubgroupSubscription

        subgroup = Subgroup.objects.get(id=event.subgroup_id)
        # "arrangementer" is the default catch-all for community events — notify everyone.
        # Only filter by subgroup subscribers for explicitly chosen specialised subgroups.
        if subgroup.slug != "arrangementer":
            subscriber_ids = SubgroupSubscription.objects.filter(
                subgroup_id=event.subgroup_id,
            ).values_list("user_id", flat=True)
            return User.objects.filter(id__in=subscriber_ids, is_active=True).exclude(
                id=exclude_user_id
            )

    return User.objects.filter(is_active=True).exclude(id=exclude_user_id)


def notify_event_created(
    event_id: int,
    author: User,
) -> int:
    """Notify users about a new community event.

    If the event has a subgroup, only notify subgroup subscribers.
    Otherwise, notify all users. Always skip the creator.

    Returns the count of notifications created.
    """
    from apps.events.models import Event

    event = Event.objects.prefetch_related("rooms").select_related("subgroup").get(id=event_id)
    location = event.resolved_location
    title_text = f"Nyt arrangement: {event.title}"
    local_start = event.start_datetime.astimezone(_CPH_TZ)
    message = location or local_start.strftime("%d/%m %H:%M")
    link = f"/kalender/{event.slug}"

    recipients = _get_event_recipients(event, exclude_user_id=author.id)

    count = 0
    for user in recipients:
        notification = create_notification(
            user=user,
            notification_type=NotificationType.EVENT_CREATED,
            title=title_text,
            message=message,
            link=link,
            related_user=author,
        )
        if notification:
            count += 1
    return count


def notify_event_updated(
    event_id: int,
    updater: User,
) -> int:
    """Notify users about a community event update (time/location change).

    If the event has RSVP enabled, only notify users with status "attending" or
    "not_answered" (skip "not_attending"). Otherwise, use the same logic as create
    (subgroup subscribers or all users). Always skip the updater.

    Returns the count of notifications created.
    """
    from apps.events.models import Event, EventAttendance

    event = Event.objects.prefetch_related("rooms").select_related("subgroup").get(id=event_id)
    location = event.resolved_location
    title_text = f"Arrangement opdateret: {event.title}"
    local_start = event.start_datetime.astimezone(_CPH_TZ)
    message = f"Ny tid/sted: {local_start.strftime('%d/%m %H:%M')}"
    if location:
        message += f" – {location}"
    link = f"/kalender/{event.slug}"

    recipients = _get_event_recipients(
        event,
        exclude_user_id=updater.id,
        rsvp_statuses=[EventAttendance.Status.ATTENDING, EventAttendance.Status.NOT_ANSWERED],
    )

    count = 0
    for user in recipients:
        notification = create_notification(
            user=user,
            notification_type=NotificationType.EVENT_UPDATED,
            title=title_text,
            message=message,
            link=link,
            related_user=updater,
        )
        if notification:
            count += 1
    return count


def notify_event_cancelled(
    event_id: int,
    canceller: User,
) -> int:
    """Notify users that a community event has been cancelled.

    Uses the same recipient priority chain as notify_event_updated:
    - RSVP enabled → attending + not_answered users, exclude canceller
    - Else if subgroup → subgroup subscribers, exclude canceller
    - Else → all users, exclude canceller

    Returns the count of notifications created.
    """
    from apps.events.models import Event, EventAttendance

    event = Event.objects.prefetch_related("rooms").select_related("subgroup").get(id=event_id)
    title_text = f"Aflyst: {event.title}"
    message = (
        event.cancellation_message
        if event.cancellation_message
        else "Arrangementet er desværre aflyst."
    )
    link = f"/kalender/{event.slug}"

    recipients = _get_event_recipients(
        event,
        exclude_user_id=canceller.id,
        rsvp_statuses=[EventAttendance.Status.ATTENDING, EventAttendance.Status.NOT_ANSWERED],
    )

    count = 0
    for user in recipients:
        notification = create_notification(
            user=user,
            notification_type=NotificationType.EVENT_CANCELLED,
            title=title_text,
            message=message,
            link=link,
            related_user=canceller,
        )
        if notification:
            count += 1
    return count


def notify_event_reminder(
    event_id: int,
    reminder_type: str,
) -> int:
    """Send reminder notifications for an upcoming community event.

    Recipients:
    - If RSVP is enabled: only users with status "attending"
    - If the event has a subgroup: subgroup subscribers
    - Otherwise: all active users

    Args:
        event_id: ID of the event to remind about
        reminder_type: "24h" or "1h"

    Returns the count of notifications created.
    """
    from apps.events.models import Event, EventAttendance

    event = Event.objects.prefetch_related("rooms").select_related("subgroup").get(id=event_id)
    location = event.resolved_location
    local_start = event.start_datetime.astimezone(_CPH_TZ)
    start_str = local_start.strftime("%d/%m kl. %H:%M")

    if reminder_type == "24h":
        title_text = f"I morgen: {event.title}"
    else:
        title_text = f"Om 1 time: {event.title}"

    message = start_str
    if location:
        message += f" – {location}"
    link = f"/kalender/{event.slug}"

    # Reminders only go to attending users (not "not_answered")
    recipients = _get_event_recipients(
        event,
        exclude_user_id=0,  # no actor to exclude for reminders
        rsvp_statuses=[EventAttendance.Status.ATTENDING],
    )

    count = 0
    for user in recipients:
        notification = create_notification(
            user=user,
            notification_type=NotificationType.EVENT_REMINDER,
            title=title_text,
            message=message,
            link=link,
        )
        if notification:
            count += 1
    return count


def notify_mentions(
    author: User,
    mentioned_user_ids: list[int],
    context_label: str,
    link: str,
    exclude_user_ids: list[int] | None = None,
) -> int:
    """Notify mentioned users.

    Args:
        author: The user who wrote the content with mentions
        mentioned_user_ids: List of user IDs that were mentioned
        context_label: Human-readable context, e.g. "indlæg i 'Tråden'"
        link: URL to the content where the mention occurred
        exclude_user_ids: User IDs to skip (already notified via another channel)

    Returns the count of notifications created.
    """
    skip_ids = set(exclude_user_ids) if exclude_user_ids else set()
    count = 0
    for user_id in set(mentioned_user_ids):
        if user_id == author.id or user_id in skip_ids:
            continue
        try:
            user = User.objects.get(id=user_id, is_active=True)
        except User.DoesNotExist:
            continue
        notification = create_notification(
            user=user,
            notification_type=NotificationType.MENTION,
            title=f"{author.first_name} nævnte dig i {context_label}",
            message="Du er blevet nævnt",
            link=link,
            related_user=author,
        )
        if notification:
            count += 1
    return count


def notify_announcement_updated(
    recipients: QuerySet[User],
    editor: User,
    announcement_title: str,
    announcement_id: int,
) -> int:
    """Notify users that a vigtig post has been edited.

    Only sent to users who have opted in (default OFF).

    Returns the count of notifications created.
    """
    count = 0
    for user in recipients.exclude(id=editor.id):
        notification = create_notification(
            user=user,
            notification_type=NotificationType.ANNOUNCEMENT_UPDATED,
            title=f"Opdateret: {announcement_title}",
            message=f"{editor.first_name} opdaterede opslaget",
            link=f"/opslag#announcement-{announcement_id}",
            related_user=editor,
        )
        if notification:
            count += 1
    return count


def notify_subgroup_activity(
    subscribers: QuerySet[User],
    replier: User,
    thread_title: str,
    thread_id: int,
    subgroup_name: str,
    subgroup_slug: str,
    thread_slug: str,
    reply_content: str,
    post_id: int = 0,
    title: str = "",
    superseded_by_map: dict[int, Sequence[str]] | None = None,
) -> int:
    """Notify subgroup subscribers about new activity in a thread they don't participate in.

    Only sent to users who have opted in (default OFF) and have
    SubgroupSubscription.notify_replies=True for this subgroup.

    superseded_by_map: {user_id: higher-priority types they already get for this activity}
    (THREAD_REPLY/POST_REPLY for fall-through participants, MENTION for fall-through mentioned
    users). Those channels are skipped per user, keeping one notification per channel while
    still showing the fall-through SUBGROUP_ACTIVITY in-app. See create_notification.

    Returns the count of notifications created.
    """
    from django.utils.html import strip_tags

    superseded_by_map = superseded_by_map or {}

    plain_text = strip_tags(reply_content)
    preview = plain_text[:80] + "..." if len(plain_text) > 80 else plain_text

    thread_link = f"/forum/{subgroup_slug}/traad/{thread_slug}"
    link = thread_link + (f"#post-{post_id}" if post_id else "")

    notification_title = title or thread_title

    count = 0
    for user in subscribers.exclude(id=replier.id):
        notification = create_notification(
            user=user,
            notification_type=NotificationType.SUBGROUP_ACTIVITY,
            title=notification_title,
            message=f"{replier.first_name}: {preview}",
            link=link,
            related_user=replier,
            group_key=thread_link,  # Aggregate activity in same thread
            superseded_by=superseded_by_map.get(user.id, ()),
        )
        if notification:
            count += 1
    return count


def notify_post_reaction(
    post_author: User,
    reactor: User,
    thread_title: str,
    thread_id: int,
    subgroup_slug: str,
    thread_slug: str,
    reaction_emoji: str,
    post_id: int = 0,
) -> Notification | None:
    """Create notification when someone reacts to a user's post.

    Args:
        post_author: The author of the post being reacted to
        reactor: User who added the reaction
        thread_title: Title of the thread containing the post
        thread_id: ID of the thread
        subgroup_slug: Slug of the subgroup for URL
        thread_slug: Slug of the thread for URL
        reaction_emoji: The emoji used for the reaction
        post_id: ID of the reacted post (for scroll-to link)
    """
    if post_author.id == reactor.id:
        return None

    from apps.forum.models import Thread as ForumThread

    try:
        event_slug = ForumThread.objects.get(id=thread_id).event.slug
        base_link = f"/kalender/{event_slug}"
    except (ForumThread.DoesNotExist, AttributeError):
        base_link = f"/forum/{subgroup_slug}/traad/{thread_slug}"

    post_fragment = f"#post-{post_id}" if post_id else ""
    link = base_link + post_fragment

    return create_notification(
        user=post_author,
        notification_type=NotificationType.POST_REACTION,
        title=f"{reactor.first_name} reagerede på dit indlæg",
        message=f'{reaction_emoji} i "{thread_title}"',
        link=link,
        related_user=reactor,
        group_key=link,  # Aggregate all reactions to same specific post
    )


def notify_subgroup_member_added(
    user: User,
    actor: User,
    subgroup_name: str,
    subgroup_slug: str,
) -> Notification | None:
    """Notify a user that they were added to a subgroup."""
    if user.id == actor.id:
        return None
    return create_notification(
        user=user,
        notification_type=NotificationType.SUBGROUP_MEMBER_ADDED,
        title=f"Du er nu medlem af {subgroup_name}",
        message=f"{actor.first_name} tilføjede dig til gruppen.",
        link=f"/forum/{subgroup_slug}",
        related_user=actor,
    )


def notify_subgroup_member_removed(
    user: User,
    actor: User,
    subgroup_name: str,
    subgroup_slug: str,
) -> Notification | None:
    """Notify a user that they were removed from a subgroup."""
    if user.id == actor.id:
        return None
    return create_notification(
        user=user,
        notification_type=NotificationType.SUBGROUP_MEMBER_REMOVED,
        title=f"Du er ikke længere medlem af {subgroup_name}",
        message=f"{actor.first_name} fjernede dig fra gruppen.",
        link=f"/forum/{subgroup_slug}",
        related_user=actor,
    )


def notify_message_reaction(
    message_author: User,
    reactor: User,
    reaction_emoji: str,
    conversation_id: int,
    message_id: int,
) -> Notification | None:
    """Create notification when someone reacts to a user's private message."""
    if message_author.id == reactor.id:
        return None

    link = f"/beskeder/{conversation_id}#msg-{message_id}"

    return create_notification(
        user=message_author,
        notification_type=NotificationType.MESSAGE_REACTION,
        title=f"{reactor.first_name} reagerede på din besked",
        message=reaction_emoji,
        link=link,
        related_user=reactor,
        group_key=link,  # Aggregate all reactions to same specific message
    )


def notify_post_edited_by_admin(
    post_author: User,
    editor: User,
    thread_title: str,
    thread_id: int,
    subgroup_slug: str,
    thread_slug: str,
    post_id: int,
) -> Notification | None:
    """Create notification when an admin edits another user's post."""
    from apps.forum.models import Thread as ForumThread

    try:
        event_slug = ForumThread.objects.get(id=thread_id).event.slug
        base_link = f"/kalender/{event_slug}"
    except (ForumThread.DoesNotExist, AttributeError):
        base_link = f"/forum/{subgroup_slug}/traad/{thread_slug}"

    link = base_link + f"#post-{post_id}"

    return create_notification(
        user=post_author,
        notification_type=NotificationType.POST_EDITED_BY_ADMIN,
        title=f"{editor.first_name} redigerede dit indlæg",
        message=f'I tråden "{thread_title}"',
        link=link,
        related_user=editor,
    )


def notify_event_edited_by_admin(
    event_creator: User,
    editor: User,
    event_title: str,
    event_slug: str,
) -> Notification | None:
    """Create notification when an admin edits another user's event."""
    link = f"/kalender/{event_slug}"

    return create_notification(
        user=event_creator,
        notification_type=NotificationType.EVENT_EDITED_BY_ADMIN,
        title=f"{editor.first_name} redigerede din begivenhed",
        message=f'"{event_title}"',
        link=link,
        related_user=editor,
    )


def notify_announcement_edited_by_admin(
    announcement_author: User,
    editor: User,
    announcement_title: str,
    announcement_id: int,
) -> Notification | None:
    """Create notification when an admin edits another user's announcement."""
    link = f"/opslag#announcement-{announcement_id}"

    return create_notification(
        user=announcement_author,
        notification_type=NotificationType.ANNOUNCEMENT_EDITED_BY_ADMIN,
        title=f"{editor.first_name} redigerede dit opslag",
        message=f'"{announcement_title}"',
        link=link,
        related_user=editor,
    )
