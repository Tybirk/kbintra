import logging

from huey import crontab
from huey.contrib.djhuey import db_periodic_task

logger = logging.getLogger(__name__)


@db_periodic_task(crontab(hour="1", minute="0", day_of_week="4"))  # Thursday 01:00
def apply_weekly_defaults_task() -> None:
    """Weekly: create default meal registrations for all active users.

    Runs every Thursday at 01:00, shortly after Wednesday's deadline passes.
    Only creates registrations that don't already exist (overwrite=False).
    """
    from apps.food.services.default_registrations import apply_weekly_defaults_for_all_users

    users, created = apply_weekly_defaults_for_all_users()
    logger.info(
        "apply_weekly_defaults_task completed: %d users processed, %d registrations created",
        users,
        created,
    )
