"""
Notification services for creating notifications.
"""

from typing import Optional

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db.models import QuerySet

from apps.users.models import User

from .models import Notification, NotificationPreference, NotificationType


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
    """Check if user wants to receive a specific notification type."""
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
        NotificationType.EVENT_REMINDER: prefs.notify_event_reminders,
        NotificationType.FOOD_TICKET: prefs.notify_food_tickets,
    }

    return preference_map.get(notification_type, True)


def create_notification(
    user: User,
    notification_type: NotificationType,
    title: str,
    message: str,
    link: str = "",
    related_user: Optional[User] = None,
    check_preferences: bool = True,
    html_content: Optional[str] = None,
) -> Optional[Notification]:
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
    try:
        send_notification_to_websocket(notification)
    except Exception:
        # Don't fail if WebSocket notification fails
        pass

    # Send email notification if user has email enabled for this type
    try:
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
    except Exception:
        # Don't fail if email notification fails
        pass

    return notification


def notify_new_message(
    recipient: User,
    sender: User,
    message_content: str,
    conversation_id: int,
) -> Optional[Notification]:
    """Create notification for a new message."""
    # Preview for in-app notification
    preview = message_content[:100] + ("..." if len(message_content) > 100 else "")
    return create_notification(
        user=recipient,
        notification_type=NotificationType.NEW_MESSAGE,
        title=f"New message from {sender.first_name}",
        message=preview,
        link=f"/messages",
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
            title="New Announcement",
            message=announcement_title,
            link=f"/announcements",
            related_user=author,
            html_content=f"<h3>{announcement_title}</h3>{announcement_content}" if announcement_content else None,
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
    initial_post_content: str = "",
) -> int:
    """Create notifications for a new thread in a subgroup.

    Args:
        subscribers: Users subscribed to the subgroup
        author: User who created the thread
        thread_title: Title of the thread
        thread_id: ID of the thread
        subgroup_name: Name of the subgroup
        initial_post_content: Full HTML content of the initial post

    Returns the count of notifications created.
    """
    count = 0
    for user in subscribers.exclude(id=author.id):
        notification = create_notification(
            user=user,
            notification_type=NotificationType.NEW_THREAD,
            title=f"New thread in {subgroup_name}",
            message=thread_title,
            link=f"/forum/thread/{thread_id}",
            related_user=author,
            html_content=f"<h3>{thread_title}</h3>{initial_post_content}" if initial_post_content else None,
        )
        if notification:
            count += 1
    return count


def notify_thread_reply(
    thread_author: User,
    replier: User,
    thread_title: str,
    thread_id: int,
    reply_content: str,
) -> Optional[Notification]:
    """Create notification for a reply to user's thread.

    Args:
        thread_author: The thread owner to notify
        replier: User who replied
        thread_title: Title of the thread
        thread_id: ID of the thread
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
        title=f"{replier.first_name} replied to your thread",
        message=f'"{thread_title}": {preview}',
        link=f"/forum/thread/{thread_id}",
        related_user=replier,
        html_content=f"<p><strong>In thread: {thread_title}</strong></p>{reply_content}",
    )


def notify_post_reply(
    post_author: User,
    replier: User,
    thread_title: str,
    thread_id: int,
    reply_content: str,
) -> Optional[Notification]:
    """Create notification for a reply after user's post.

    Args:
        post_author: User who posted previously in the thread
        replier: User who replied
        thread_title: Title of the thread
        thread_id: ID of the thread
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
        title=f"{replier.first_name} replied in a thread you're in",
        message=f'"{thread_title}": {preview}',
        link=f"/forum/thread/{thread_id}",
        related_user=replier,
        html_content=f"<p><strong>In thread: {thread_title}</strong></p>{reply_content}",
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
            title="Food ticket available",
            message=f"{owner.first_name} is offering {portions} portion(s) for {ticket_date}",
            link="/food/tickets",
            related_user=owner,
        )
        if notification:
            count += 1
    return count


def notify_ticket_claimed(
    owner: User,
    claimer: User,
    ticket_date: str,
) -> Optional[Notification]:
    """Notify ticket owner that their ticket was claimed."""
    return create_notification(
        user=owner,
        notification_type=NotificationType.FOOD_TICKET,
        title="Your food ticket was claimed",
        message=f"{claimer.first_name} claimed your ticket for {ticket_date}",
        link="/food/tickets",
        related_user=claimer,
        check_preferences=False,  # Always notify owner
    )
