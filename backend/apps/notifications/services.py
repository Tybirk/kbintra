"""
Notification services for creating notifications.
"""

import contextlib
import json
import logging
import time
from urllib.parse import urlparse

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.db.models import QuerySet

from apps.users.models import User

from .models import Notification, NotificationPreference, NotificationType, PushSubscription

logger = logging.getLogger(__name__)


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
        "related_user": None,
        "created_at": notification.created_at.isoformat(),
    }

    if notification.related_user:
        notification_data["related_user"] = {
            "id": notification.related_user.id,
            "first_name": notification.related_user.first_name,
            "last_name": notification.related_user.last_name,
            "profile_picture": (
                notification.related_user.profile_picture.url
                if notification.related_user.profile_picture
                else None
            ),
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
        NotificationType.NEW_MESSAGE: prefs.notify_messages,
        NotificationType.NEW_ANNOUNCEMENT: prefs.notify_announcements,
        NotificationType.NEW_THREAD: prefs.notify_forum_subscriptions,
        NotificationType.THREAD_REPLY: prefs.notify_thread_replies,
        NotificationType.POST_REPLY: prefs.notify_thread_replies,
        NotificationType.POST_REACTION: prefs.notify_post_reactions,
        NotificationType.EVENT_REMINDER: prefs.notify_event_reminders,
        NotificationType.FOOD_TICKET: prefs.notify_food_tickets,
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
        NotificationType.NEW_THREAD: prefs.push_forum_subscriptions,
        NotificationType.THREAD_REPLY: prefs.push_thread_replies,
        NotificationType.POST_REPLY: prefs.push_thread_replies,
        NotificationType.POST_REACTION: prefs.push_post_reactions,
        NotificationType.EVENT_REMINDER: prefs.push_event_reminders,
        NotificationType.FOOD_TICKET: prefs.push_food_tickets,
    }

    return preference_map.get(notification_type, True)


def send_push_notification(
    user: User,
    notification_type: NotificationType,
    title: str,
    message: str,
    link: str = "",
) -> int:
    """Send push notification to all user's subscribed devices.

    Args:
        user: The user to notify
        notification_type: Type of notification (for preference checking)
        title: Notification title
        message: Notification body
        link: URL to open when notification is clicked

    Returns:
        Number of successful push notifications sent
    """
    # Check if push notifications are configured
    vapid_private_key = getattr(settings, "VAPID_PRIVATE_KEY", None)
    vapid_claims = getattr(settings, "VAPID_CLAIMS", None)

    if not vapid_private_key or not vapid_claims:
        logger.debug("Push notifications not configured, skipping")
        return 0

    # Check user push preference
    if not get_user_push_preference(user, notification_type):
        logger.debug(f"User {user.id} has push disabled for {notification_type}")
        return 0

    # Get user's push subscriptions
    subscriptions = PushSubscription.objects.filter(user=user)
    if not subscriptions.exists():
        logger.debug(f"User {user.id} has no push subscriptions")
        return 0

    # Import pywebpush here to avoid import errors if not installed
    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        logger.warning("pywebpush not installed, skipping push notifications")
        return 0

    # Prepare notification payload
    payload = json.dumps(
        {
            "title": title,
            "body": message,
            "icon": "/pwa-192x192.png",
            "badge": "/pwa-192x192.png",
            "data": {
                "url": link,
                "notification_type": notification_type,
            },
        }
    )

    success_count = 0
    expired_subscriptions = []

    for subscription in subscriptions:
        try:
            # Build claims with aud (audience) derived from endpoint
            # Apple requires aud to be the push service origin (e.g., https://web.push.apple.com)
            parsed = urlparse(subscription.endpoint)
            claims = vapid_claims.copy()
            claims["aud"] = f"{parsed.scheme}://{parsed.netloc}"
            claims["exp"] = int(time.time()) + 86400  # 24 hours

            response = webpush(
                subscription_info=subscription.get_subscription_info(),
                data=payload,
                vapid_private_key=vapid_private_key,
                vapid_claims=claims,
            )
            success_count += 1
            logger.info(
                f"Push sent to subscription {subscription.id}: "
                f"status={response.status_code}, endpoint={parsed.netloc}"
            )
        except WebPushException as e:
            # Handle expired/invalid subscriptions
            if e.response and e.response.status_code in (404, 410):
                logger.info(f"Push subscription {subscription.id} is expired, marking for deletion")
                expired_subscriptions.append(subscription.id)
            else:
                logger.error(f"Push notification failed for subscription {subscription.id}: {e}")
        except Exception as e:
            logger.error(f"Unexpected error sending push notification: {e}")

    # Log expired subscriptions but don't delete (for debugging)
    if expired_subscriptions:
        logger.warning(
            f"Found {len(expired_subscriptions)} expired push subscriptions "
            f"(IDs: {expired_subscriptions}) - NOT deleting for now"
        )

    return success_count


def create_notification(
    user: User,
    notification_type: NotificationType,
    title: str,
    message: str,
    link: str = "",
    related_user: User | None = None,
    check_preferences: bool = True,
    html_content: str | None = None,
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

    Returns:
        The created notification, or None if user opted out
    """
    # Check user preferences
    if check_preferences and not get_user_preference(user, notification_type):
        return None

    notification = Notification.objects.create(
        user=user,
        notification_type=notification_type,
        title=title,
        message=message,
        link=link,
        related_user=related_user,
    )

    # Send real-time notification via WebSocket
    with contextlib.suppress(Exception):
        send_notification_to_websocket(notification)

    # Send email notification if user has email enabled for this type
    with contextlib.suppress(Exception):
        from .email_service import send_notification_email

        send_notification_email(
            user=user,
            notification_type=notification_type,
            title=title,
            message=message,
            link=link,
            related_user=related_user,
            html_content=html_content,
        )

    # Send push notification if user has push enabled for this type
    with contextlib.suppress(Exception):
        send_push_notification(
            user=user,
            notification_type=notification_type,
            title=title,
            message=message,
            link=link,
        )

    return notification


def notify_new_message(
    recipient: User,
    sender: User,
    message_content: str,
    conversation_id: int,
) -> Notification | None:
    """Create notification for a new message."""
    # Preview for in-app notification
    preview = message_content[:100] + ("..." if len(message_content) > 100 else "")
    return create_notification(
        user=recipient,
        notification_type=NotificationType.NEW_MESSAGE,
        title=f"Ny besked fra {sender.first_name}",
        message=preview,
        link=f"/beskeder/{conversation_id}",
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
    count = 0
    for user in recipients.exclude(id=author.id):
        notification = create_notification(
            user=user,
            notification_type=NotificationType.NEW_ANNOUNCEMENT,
            title="Nyt opslag",
            message=announcement_title,
            link="/opslag",
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
    initial_post_content: str = "",
) -> int:
    """Create notifications for a new thread in a subgroup.

    Args:
        subscribers: Users subscribed to the subgroup
        author: User who created the thread
        thread_title: Title of the thread
        thread_id: ID of the thread
        subgroup_name: Name of the subgroup
        subgroup_slug: Slug of the subgroup for URL
        initial_post_content: Full HTML content of the initial post

    Returns the count of notifications created.
    """
    count = 0
    for user in subscribers.exclude(id=author.id):
        notification = create_notification(
            user=user,
            notification_type=NotificationType.NEW_THREAD,
            title=f"Ny tråd i {subgroup_name}",
            message=thread_title,
            link=f"/forum/{subgroup_slug}/{thread_id}",
            related_user=author,
            html_content=f"<h3>{thread_title}</h3>{initial_post_content}"
            if initial_post_content
            else None,
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
    reply_content: str,
) -> Notification | None:
    """Create notification for a reply to user's thread.

    Args:
        thread_author: The thread owner to notify
        replier: User who replied
        thread_title: Title of the thread
        thread_id: ID of the thread
        subgroup_slug: Slug of the subgroup for URL
        reply_content: Full HTML content of the reply
    """
    if thread_author.id == replier.id:
        return None

    # Create preview for in-app notification (strip HTML for preview)
    from django.utils.html import strip_tags

    plain_text = strip_tags(reply_content)
    preview = plain_text[:80] + "..." if len(plain_text) > 80 else plain_text

    return create_notification(
        user=thread_author,
        notification_type=NotificationType.THREAD_REPLY,
        title=f"{replier.first_name} svarede på din tråd",
        message=f'"{thread_title}": {preview}',
        link=f"/forum/{subgroup_slug}/{thread_id}",
        related_user=replier,
        html_content=f"<p><strong>I tråden: {thread_title}</strong></p>{reply_content}",
    )


def notify_post_reply(
    post_author: User,
    replier: User,
    thread_title: str,
    thread_id: int,
    subgroup_slug: str,
    reply_content: str,
) -> Notification | None:
    """Create notification for a reply after user's post.

    Args:
        post_author: User who posted previously in the thread
        replier: User who replied
        thread_title: Title of the thread
        thread_id: ID of the thread
        subgroup_slug: Slug of the subgroup for URL
        reply_content: Full HTML content of the reply
    """
    if post_author.id == replier.id:
        return None

    # Create preview for in-app notification (strip HTML for preview)
    from django.utils.html import strip_tags

    plain_text = strip_tags(reply_content)
    preview = plain_text[:80] + "..." if len(plain_text) > 80 else plain_text

    return create_notification(
        user=post_author,
        notification_type=NotificationType.POST_REPLY,
        title=f"{replier.first_name} svarede i en tråd du følger",
        message=f'"{thread_title}": {preview}',
        link=f"/forum/{subgroup_slug}/{thread_id}",
        related_user=replier,
        html_content=f"<p><strong>I tråden: {thread_title}</strong></p>{reply_content}",
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


def notify_post_reaction(
    post_author: User,
    reactor: User,
    thread_title: str,
    thread_id: int,
    subgroup_slug: str,
    reaction_emoji: str,
) -> Notification | None:
    """Create notification when someone reacts to a user's post.

    Args:
        post_author: The author of the post being reacted to
        reactor: User who added the reaction
        thread_title: Title of the thread containing the post
        thread_id: ID of the thread
        subgroup_slug: Slug of the subgroup for URL
        reaction_emoji: The emoji used for the reaction
    """
    if post_author.id == reactor.id:
        return None

    return create_notification(
        user=post_author,
        notification_type=NotificationType.POST_REACTION,
        title=f"{reactor.first_name} reagerede på dit indlæg",
        message=f'{reaction_emoji} i "{thread_title}"',
        link=f"/forum/{subgroup_slug}/{thread_id}",
        related_user=reactor,
    )
