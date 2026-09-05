"""
Huey background tasks for the food app.

- materialize_week_registrations: every Thursday at 00:30 (just after the
  Wednesday 23:59 deadline), creates real MealRegistration rows for all houses
  that don't have one for the upcoming Mon-Thu. This "freezes" preference
  values so later preference changes don't retroactively affect billing.
- refresh_drive_menus_periodic: every 4 hours, refreshes the Google Drive menu
  cache so user-facing requests never have to wait on the Drive API.
- refresh_drive_menu_week_task: refreshes a single week's menu in the
  background. Triggered by /api/food/drive-menu/ when the cache is stale, so
  the user gets the stale menu immediately and the next request gets fresh.
- send_food_team_reminders: daily at 20:00, reminds tomorrow's cooking team and
  the rest of each cook's household.
- notify_paused_residents_of_new_cycle: asks everyone on a standing madhold
  pause whether it still holds, when a new period opens for wishes.
"""

import logging
from datetime import date, timedelta

from django.utils import timezone
from huey import crontab
from huey.contrib.djhuey import db_periodic_task, db_task

logger = logging.getLogger(__name__)


def _materialize_for_houses(dates: list[date]) -> int:
    """Create MealRegistration rows for all houses missing one on the given dates.

    Uses the house's MealPreference (if any) or system defaults (house_count veg).

    Uses get_or_create to safely handle concurrent calls (e.g. simultaneous
    view requests or overlap with the periodic task).

    Returns the number of registrations created.
    """
    from apps.houses.models import House

    from .models import MealPreference, MealRegistration
    from .utils import get_closed_food_dates

    created = 0
    closed = get_closed_food_dates(dates)

    # Pre-fetch all preferences keyed by (house_id, day_of_week)
    all_prefs: dict[tuple[int, int], MealPreference] = {}
    for pref in MealPreference.objects.select_related("house"):
        key = (pref.house_id, pref.day_of_week)
        all_prefs[key] = pref

    for house in House.objects.prefetch_related("inhabitants"):
        inhabitants = list(house.inhabitants.filter(is_active=True))
        if not inhabitants:
            continue
        house_count = len(inhabitants)

        for target_date in dates:
            if target_date.weekday() > 3 or target_date in closed:
                continue

            # Skip if house already has a registration for this date
            has_reg = MealRegistration.objects.filter(house=house, date=target_date).exists()
            if has_reg:
                continue

            pref = all_prefs.get((house.id, target_date.weekday()))

            if pref:
                meat, veg, children = pref.adults_meat, pref.adults_veg, pref.children_count
                dining, seating = pref.dining_option, pref.seating_time
            else:
                meat, veg, children = 0, house_count, 0
                dining, seating = "eat_in", "17:30"

            _, was_created = MealRegistration.objects.get_or_create(
                house=house,
                date=target_date,
                defaults={
                    "last_modified_by": inhabitants[0],
                    "adults_meat": meat,
                    "adults_veg": veg,
                    "children_count": children,
                    "dining_option": dining,
                    "seating_time": seating,
                    "is_active": meat + veg + children > 0,
                },
            )
            if was_created:
                created += 1

    return created


@db_periodic_task(crontab(day_of_week="4", hour="0", minute="30"))
def materialize_week_registrations() -> None:
    """Run every Thursday 00:30 to freeze registrations for the upcoming Mon-Thu.

    The registration deadline is Wednesday 23:59:59, so by Thursday 00:30 the
    deadline has passed and all preferences should be locked in as real rows.
    """
    today = date.today()
    # Next Monday: move forward to the coming Monday regardless of current weekday
    days_ahead = (7 - today.weekday()) % 7
    if days_ahead == 0:
        days_ahead = 7
    next_monday = today + timedelta(days=days_ahead)
    dates = [next_monday + timedelta(days=d) for d in range(4)]

    logger.info("Materializing registrations for %s to %s", dates[0], dates[-1])
    created = _materialize_for_houses(dates)
    logger.info("Materialized %d registrations", created)


@db_periodic_task(crontab(hour=20, minute=0))
def send_food_team_reminders() -> None:
    """Run daily at 20:00 to remind tomorrow's cooking team — and their households.

    Finds the FoodTeam cooking tomorrow (date == today + 1 day) and notifies
    each of its members, plus the rest of each cook's house: a partner plans the
    evening around that shift too, and until now had to remember it themselves.
    Household members who cook tomorrow as well are skipped — they already got
    their own reminder.
    """
    from apps.notifications.services import (
        notify_food_team_housemate_reminder,
        notify_food_team_reminder,
    )
    from apps.users.models import User

    from .models import FoodTeam

    tomorrow = date.today() + timedelta(days=1)
    team = FoodTeam.objects.filter(date=tomorrow).prefetch_related("members__user").first()
    if team is None:
        logger.info("No food team cooking on %s; no reminders sent", tomorrow)
        return

    date_iso = team.date.isoformat()
    notified = 0
    cooks_by_house: dict[int, list[str]] = {}
    for member in team.members.all():
        notify_food_team_reminder(member.user, date_iso)
        notified += 1
        if member.user.house_id:
            cooks_by_house.setdefault(member.user.house_id, []).append(member.user.first_name)

    cook_ids = {member.user_id for member in team.members.all()}
    housemates = 0
    if cooks_by_house:
        for mate in User.objects.filter(house_id__in=cooks_by_house.keys(), is_active=True).exclude(
            pk__in=cook_ids
        ):
            notify_food_team_housemate_reminder(mate, cooks_by_house[mate.house_id], date_iso)
            housemates += 1

    logger.info(
        "Sent %d food team reminders (+%d household) for %s", notified, housemates, date_iso
    )


@db_task()
def notify_paused_residents_of_new_cycle(cycle_id: int) -> None:
    """Ask everyone on a standing madhold pause whether the break still holds.

    Fires when an admin opens a new period for wishes: that is the only moment
    where the answer can still change the plan, and a pause set months ago is
    otherwise never revisited. Nobody has to act — doing nothing keeps the pause.
    """
    from apps.notifications.services import notify_food_team_pause_check
    from apps.users.models import User

    from .models import FoodTeamCycle

    cycle = FoodTeamCycle.objects.filter(pk=cycle_id).first()
    if cycle is None:
        logger.warning("Cycle %s is gone; no pause checks sent", cycle_id)
        return

    deadline = timezone.localtime(cycle.wish_deadline)
    deadline_label = f"{deadline.day}/{deadline.month}"

    asked = 0
    for user in User.objects.filter(is_active=True, is_exempt_from_food_teams=True):
        notify_food_team_pause_check(user, cycle.name, deadline_label)
        asked += 1

    logger.info("Asked %d paused residents about cycle %s", asked, cycle_id)


@db_task(retries=1, retry_delay=60)
def refresh_drive_menu_week_task(week_number: int, year: int) -> None:
    """Refresh a single week's menu from Google Drive in the background."""
    from apps.food.services.drive_menu import DriveMenuService

    service = DriveMenuService()
    try:
        service.get_menu_for_week(week_number, year, force_refresh=True)
    except Exception:
        logger.exception("Failed to refresh drive menu for week %d/%d", week_number, year)


@db_periodic_task(crontab(minute="0", hour="*/4"))
def refresh_drive_menus_periodic() -> None:
    """Refresh all Drive menus every 4 hours so the cache is rarely stale."""
    from apps.food.services.drive_menu import DriveMenuService

    service = DriveMenuService()
    try:
        result = service.refresh_all_menus()
        logger.info(
            "Periodic Drive menu refresh: %d updated, %d failed",
            result["updated"],
            result["failed"],
        )
    except Exception:
        logger.exception("Periodic Drive menu refresh failed")
