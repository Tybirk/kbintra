"""Periodic-task schedules in Copenhagen time."""

from collections.abc import Callable
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from django.conf import settings
from huey import crontab


def local_crontab(**kwargs: str | int) -> Callable[[datetime], bool]:
    """A Huey crontab read in ``settings.TIME_ZONE`` rather than UTC.

    Huey checks periodic tasks against a naive UTC timestamp, and its crontab has
    no timezone, so a bare ``crontab(hour=8)`` fires at 10:00 in summer and 09:00
    in winter here. This converts the timestamp first, so "08:00" means 08:00 all
    year. Only for wall-clock tasks; hourly ones don't care.
    """
    matches = crontab(**kwargs)
    tz = ZoneInfo(settings.TIME_ZONE)

    def validate(utc: datetime) -> bool:
        return matches(utc.replace(tzinfo=UTC).astimezone(tz).replace(tzinfo=None))

    return validate
