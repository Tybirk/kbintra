"""
Huey background tasks for the food app.

The main task here is materialize_week_registrations, a periodic task that runs
every Thursday at 00:30 (just after the Wednesday 23:59 deadline) and creates
real MealRegistration rows for all houses that don't have one for the upcoming
Mon-Thu. This "freezes" the preference values so that later preference changes
don't retroactively affect billing.
"""

import logging
from datetime import date, timedelta

from huey import crontab
from huey.contrib.djhuey import db_periodic_task, db_task

logger = logging.getLogger(__name__)


def _materialize_for_houses(dates: list[date]) -> int:
    """Create MealRegistration rows for all houses missing one on the given dates.

    For each house, picks one active user (preferring one with a MealPreference)
    and creates a registration using their preference values (or system defaults).

    Returns the number of registrations created.
    """
    from apps.houses.models import House

    from .models import MealPreference, MealRegistration

    created = 0

    # Pre-fetch all preferences keyed by (house_id, day_of_week)
    all_prefs: dict[tuple[int, int], MealPreference] = {}
    for pref in MealPreference.objects.filter(user__is_active=True).select_related("user__house"):
        house = pref.user.house
        if house:
            key = (house.id, pref.day_of_week)
            if key not in all_prefs:
                all_prefs[key] = pref

    for house in House.objects.prefetch_related("inhabitants"):
        inhabitants = list(house.inhabitants.filter(is_active=True))
        if not inhabitants:
            continue
        house_count = len(inhabitants)

        for target_date in dates:
            if target_date.weekday() > 3:
                continue

            # Skip if any user in this house already has a registration for this date
            has_reg = MealRegistration.objects.filter(user__house=house, date=target_date).exists()
            if has_reg:
                continue

            pref = all_prefs.get((house.id, target_date.weekday()))

            # Pick the user who owns the preference, or fall back to first inhabitant
            user = pref.user if pref else inhabitants[0]

            if pref:
                meat, veg, children = pref.adults_meat, pref.adults_veg, pref.children_count
                dining, seating = pref.dining_option, pref.seating_time
            else:
                meat, veg, children = 0, house_count, 0
                dining, seating = "eat_in", "17:30"

            MealRegistration.objects.create(
                user=user,
                date=target_date,
                house=house,
                adults_meat=meat,
                adults_veg=veg,
                children_count=children,
                dining_option=dining,
                seating_time=seating,
                is_active=meat + veg + children > 0,
            )
            created += 1

    return created


@db_periodic_task(crontab(day_of_week="4", hour="0", minute="30"))
def materialize_week_registrations() -> None:
    """Run every Thursday 00:30 to freeze registrations for the upcoming Mon-Thu.

    The registration deadline is Wednesday 23:59:59, so by Thursday 00:30 the
    deadline has passed and all preferences should be locked in as real rows.
    """
    # The upcoming Monday is 4 days after Thursday
    today = date.today()
    # today is Thursday (weekday 3). Next Monday = today + 4 days.
    next_monday = today + timedelta(days=(7 - today.weekday()))
    dates = [next_monday + timedelta(days=d) for d in range(4)]

    logger.info("Materializing registrations for %s to %s", dates[0], dates[-1])
    created = _materialize_for_houses(dates)
    logger.info("Materialized %d registrations", created)


@db_task(retries=1, retry_delay=60)
def materialize_dates_task(date_strings: list[str]) -> None:
    """Materialize registrations for arbitrary dates. Called as safety net from billing."""
    dates = [date.fromisoformat(s) for s in date_strings]
    created = _materialize_for_houses(dates)
    logger.info(
        "materialize_dates_task: created %d registrations for %d dates", created, len(dates)
    )
