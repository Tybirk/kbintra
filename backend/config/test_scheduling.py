from datetime import datetime, timedelta

from config.scheduling import local_crontab


def _matching_utc_times(validate, day: datetime) -> list[str]:
    minutes = (day + timedelta(minutes=m) for m in range(24 * 60))
    return [t.strftime("%H:%M") for t in minutes if validate(t)]


def test_eight_oclock_is_eight_in_copenhagen_all_year():
    """Huey hands periodic tasks naive UTC; 08:00 local is 06:00 UTC in summer, 07:00 in winter."""
    at_eight = local_crontab(hour=8, minute=0)

    assert _matching_utc_times(at_eight, datetime(2026, 7, 1)) == ["06:00"]
    assert _matching_utc_times(at_eight, datetime(2026, 1, 15)) == ["07:00"]


def test_weekday_is_the_local_weekday():
    """Thursday 00:30 in Copenhagen is still Wednesday in UTC."""
    thursday_half_past_midnight = local_crontab(day_of_week="4", hour="0", minute="30")

    assert thursday_half_past_midnight(datetime(2026, 9, 30, 22, 30))  # Wed 22:30 UTC
    assert not thursday_half_past_midnight(datetime(2026, 10, 1, 0, 30))  # Thu 02:30 local
