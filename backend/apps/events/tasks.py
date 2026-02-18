"""
Periodic tasks for the Events app.
"""

import logging
from datetime import timedelta

from huey import crontab
from huey.contrib.djhuey import db_periodic_task

logger = logging.getLogger(__name__)


@db_periodic_task(crontab(minute="0"))
def send_event_reminders() -> None:
    """Hourly scan for upcoming community events that need reminder notifications.

    Two reminder windows are checked each run:
    - 24h: events starting between 23 and 25 hours from now
    - 1h:  events starting between 30 and 90 minutes from now

    EventReminderLog ensures each (event, reminder_type) pair is sent at most once.
    The actual notifications are dispatched via notify_event_reminder_task so that
    the DB work runs in a separate transaction per event and failures are retried
    independently.
    """
    from django.utils import timezone

    from apps.events.models import Event, EventReminderLog
    from apps.notifications.tasks import notify_event_reminder_task

    now = timezone.now()

    windows = [
        (EventReminderLog.ReminderType.H24, now + timedelta(hours=23), now + timedelta(hours=25)),
        (
            EventReminderLog.ReminderType.H1,
            now + timedelta(minutes=30),
            now + timedelta(minutes=90),
        ),
    ]

    for reminder_type, start, end in windows:
        # Only community events that haven't had this reminder sent yet
        events = Event.objects.filter(
            start_datetime__gte=start,
            start_datetime__lt=end,
            visibility=Event.Visibility.COMMUNITY,
        ).exclude(
            reminder_logs__reminder_type=reminder_type,
        )

        for event in events:
            logger.info(
                "Enqueueing %s reminder for event %d (%s)",
                reminder_type,
                event.id,
                event.title,
            )
            notify_event_reminder_task(event.id, reminder_type)
