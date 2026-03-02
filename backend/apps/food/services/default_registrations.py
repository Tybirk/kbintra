"""
Logic for applying default meal registrations to users.
Used by ApplyDefaultsView (per-user), management command, and Huey periodic task.
"""

import logging
from datetime import date, timedelta

from django.utils import timezone

from apps.food.serializers import is_after_deadline

logger = logging.getLogger(__name__)

_WEEKDAYS = range(4)  # 0=Mon, 1=Tue, 2=Wed, 3=Thu


def apply_defaults_for_user(user: object, week_start: date, overwrite: bool = False) -> int:
    """Apply default registrations for one user for one week.

    Respects user's MealPreferences if set; otherwise defaults to all-vegetarian.
    Default for Wednesday is also vegetarian (meat is an opt-in via preferences).

    overwrite=False (default): only creates registrations that don't exist yet.
    overwrite=True (user-triggered): also updates existing ones.

    Returns number of registrations created.
    """
    from apps.food.models import MealPreference, MealRegistration

    house = user.house
    house_count = house.inhabitants.count() if house else 1

    preferences = {p.day_of_week: p for p in MealPreference.objects.filter(user=user)}
    created_count = 0

    days = list(preferences.keys()) if preferences else list(_WEEKDAYS)

    for day in days:
        reg_date = week_start + timedelta(days=day)

        if reg_date < timezone.now().date():
            continue
        if is_after_deadline(reg_date):
            continue

        pref = preferences.get(day)
        if pref:
            defaults = {
                "house": house,
                "adults_meat": pref.adults_meat,
                "adults_veg": pref.adults_veg,
                "children_count": pref.children_count,
                "dining_option": pref.dining_option,
                "seating_time": pref.seating_time,
                "is_active": True,
            }
        else:
            defaults = {
                "house": house,
                "adults_veg": house_count,
                "adults_meat": 0,  # vegetarian by default every day, incl. Wednesday
                "children_count": 0,
                "dining_option": "eat_in",
                "seating_time": "17:30",
                "is_active": True,
            }

        if overwrite:
            _, created = MealRegistration.objects.update_or_create(
                user=user, date=reg_date, defaults=defaults
            )
        else:
            _, created = MealRegistration.objects.get_or_create(
                user=user, date=reg_date, defaults=defaults
            )

        if created:
            created_count += 1

    return created_count


def apply_weekly_defaults_for_all_users() -> tuple[int, int]:
    """Create missing default registrations for all active users.

    Covers the current week plus the next two weeks.
    Never overwrites registrations users have already made.

    Returns (users_count, registrations_created).
    """
    from apps.users.models import User

    today = timezone.now().date()
    current_monday = today - timedelta(days=today.weekday())

    users = list(User.objects.filter(is_active=True).select_related("house"))
    total_created = 0

    for week_offset in range(3):
        week_start = current_monday + timedelta(weeks=week_offset)
        for user in users:
            total_created += apply_defaults_for_user(user, week_start, overwrite=False)

    logger.info(
        "apply_weekly_defaults: processed %d users, created %d registrations",
        len(users),
        total_created,
    )
    return len(users), total_created
