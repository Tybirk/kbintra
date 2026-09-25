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
- send_wish_deadline_reminders: daily at 17:30, nudges anyone who still owes
  wishes a day or two before a period's deadline (once per period).
- notify_residents_of_new_cycle: when a period opens, invites everyone to submit
  wishes — and asks those on a standing pause whether it still holds instead.
- notify_food_team_plan_ready: after a real generation, tells every cook which
  days they got.
"""

import logging
from datetime import date, timedelta

from django.utils import timezone
from huey import crontab
from huey.contrib.djhuey import db_periodic_task, db_task

from config.scheduling import local_crontab

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


@db_periodic_task(local_crontab(day_of_week="4", hour="0", minute="30"))
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


@db_periodic_task(local_crontab(hour=20, minute=0))
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


def _deadline_label(cycle) -> str:  # type: ignore[no-untyped-def]
    """The wish deadline as ``14/5``, in local time."""
    deadline = timezone.localtime(cycle.wish_deadline)
    return f"{deadline.day}/{deadline.month}"


@db_task()
def notify_residents_of_new_cycle(cycle_id: int) -> None:
    """Tell everyone a new madhold period is open, in the way each of them needs.

    Two audiences, one moment — opening the period is the last point at which
    anybody's answer can still change the plan:

    - **Participating residents** get "der er åbnet for ønsker". They used to get
      nothing at all and had to notice an orange badge on a tab, even though a
      forgotten wish quietly costs them a say: the generator then falls back to
      their standing weekdays, or treats them as free every day.
    - **Residents on a standing pause** are asked instead whether the pause still
      holds. A pause set months ago is otherwise never revisited, and doing
      nothing keeps it on.

    Nobody gets both — the question you are asked depends on whether you are in.
    """
    from apps.notifications.services import (
        notify_food_team_pause_check,
        notify_food_team_wishes_open,
    )
    from apps.users.models import User

    from .models import FoodTeamCycle

    cycle = FoodTeamCycle.objects.filter(pk=cycle_id).first()
    if cycle is None:
        logger.warning("Cycle %s is gone; nobody told about it", cycle_id)
        return

    deadline_label = _deadline_label(cycle)

    asked = invited = 0
    for user in User.objects.filter(is_active=True):
        if user.is_exempt_from_food_teams:
            notify_food_team_pause_check(user, cycle.name, deadline_label)
            asked += 1
        else:
            notify_food_team_wishes_open(user, cycle.name, deadline_label)
            invited += 1

    logger.info(
        "Cycle %s opened: invited %d residents, asked %d on a pause", cycle_id, invited, asked
    )


# How far ahead of the wish deadline the nudge goes out. The task runs daily, so
# the window has to be wider than a day for a deadline at any hour to be caught;
# 48h means everyone is nudged between one and two days before, never after.
WISH_REMINDER_LEAD_HOURS = 48


@db_periodic_task(local_crontab(hour=17, minute=30))
def send_wish_deadline_reminders() -> None:
    """Nudge residents who still owe wishes, a day or two before the deadline.

    17:30 because that is when people are already looking at the app for the
    menu. Guarded by ``cycle.wish_reminder_sent_at`` so a period can only ever
    produce one nudge, however many days its window stays open.
    """
    from apps.notifications.services import notify_food_team_wish_deadline
    from apps.users.models import User

    from .models import CycleStatus, FoodTeamCycle, FoodTeamWish

    now = timezone.now()
    cycles = FoodTeamCycle.objects.filter(
        status=CycleStatus.COLLECTING_WISHES,
        wish_reminder_sent_at__isnull=True,
        wish_deadline__gt=now,
        wish_deadline__lte=now + timedelta(hours=WISH_REMINDER_LEAD_HOURS),
    )

    for cycle in cycles:
        submitted = set(FoodTeamWish.objects.filter(cycle=cycle).values_list("user_id", flat=True))
        deadline_label = _deadline_label(cycle)
        nudged = 0
        for user in User.objects.filter(is_active=True, is_exempt_from_food_teams=False).exclude(
            pk__in=submitted
        ):
            notify_food_team_wish_deadline(user, cycle.name, deadline_label)
            nudged += 1

        # Stamped even when nobody needed nudging: the question "has this period
        # had its reminder?" must have one answer, and a period where everyone
        # answered in time has had all the reminding it needs.
        cycle.wish_reminder_sent_at = now
        cycle.save(update_fields=["wish_reminder_sent_at", "updated_at"])
        logger.info("Nudged %d residents about wishes for cycle %s", nudged, cycle.pk)


@db_task(retries=1, retry_delay=60)
def notify_food_team_plan_ready(cycle_id: int) -> None:
    """Tell every cook which days they got, right after a period is planned.

    The biggest announcement madhold makes, and until now it made none: the
    first a resident heard of their own cooking days was the 20:00 reminder the
    night before the first one. Runs as a task because it fans out to ~90
    people with email and push behind each one, and the admin should not wait
    for that inside the generate request.
    """
    from apps.notifications.services import notify_food_team_plan_ready as notify_one
    from apps.users.models import User

    from .models import FoodTeamCycle, FoodTeamMember

    cycle = FoodTeamCycle.objects.filter(pk=cycle_id).first()
    if cycle is None:
        logger.warning("Cycle %s is gone; no plan announcements sent", cycle_id)
        return

    # One query for the whole cycle's memberships, then one notification per
    # cook naming all of their days — not one per shift, which would land as
    # several near-identical messages for anyone cooking twice in a period.
    cooks: dict[int, tuple[User, list[str]]] = {}
    for member in FoodTeamMember.objects.filter(team__cycle_id=cycle_id).select_related(
        "team", "user"
    ):
        if not member.user.is_active:
            continue
        _cook, dates = cooks.setdefault(member.user_id, (member.user, []))
        dates.append(member.team.date.isoformat())

    for cook, dates in cooks.values():
        notify_one(cook, cycle.name, dates)

    logger.info("Announced the plan for cycle %s to %d cooks", cycle_id, len(cooks))


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
