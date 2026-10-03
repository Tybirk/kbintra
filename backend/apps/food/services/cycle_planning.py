"""Planning helpers for creating the next food-team cycle.

Centralises the "what should the next madhold period look like?" logic so the
admin create-cycle form, the API, and the test seeder all agree:

- **Eligible cooks**: residents (active, with a house) who have not opted out
  (``is_exempt_from_food_teams``). Children are not in scope because residents
  under 18 do not have user accounts; the opt-out flag is the single source of
  truth for participation.
- **Suggested number of cooking days**: ``round(eligible / 6)`` — each team
  targets ~6 people (the generator overflows to 7 as needed). This mirrors the
  community's own spreadsheet ("Antal maddage per cyklus" = total cooks / 6).
- **Suggested dates**: the next Mon–Thu cooking days, skipping ``ClosedFoodDay``
  s, continuing after the latest existing cycle so periods don't overlap, and
  never sooner than a period opened today can still be planned for.
- **Wish deadline**: a week out, but closing ``DEADLINE_DAYS_BEFORE_START``
  days before the first cooking day.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

from django.utils import timezone

# Cooking happens Mon–Thu only (weekday 0–3).
LAST_COOKING_WEEKDAY = 3
TARGET_TEAM_SIZE = 6
# Guard so date scanning can never loop forever (covers long closed-day runs).
_SCAN_GUARD = 800
# The wish deadline closes this many days before the first cooking day: the
# admin generates the day after it, and the plan has to be out before the first
# day's 20:00 reminder the evening before. A deadline the evening before the
# first day meant nobody could be planned in time for it.
DEADLINE_DAYS_BEFORE_START = 2
# How long wishes stay open when the first cooking day is far enough away.
WISH_WINDOW_DAYS = 7

DANISH_MONTHS = {
    1: "januar",
    2: "februar",
    3: "marts",
    4: "april",
    5: "maj",
    6: "juni",
    7: "juli",
    8: "august",
    9: "september",
    10: "oktober",
    11: "november",
    12: "december",
}


def eligible_food_team_count() -> int:
    """Number of residents who are not on a madhold pause."""
    from apps.food.utils import food_team_pool

    return food_team_pool().count()


def suggested_day_count(eligible: int | None = None) -> int:
    """Suggested number of cooking days for a cycle: ``eligible // 6``.

    Floor, not round: a team never goes below ``TARGET_TEAM_SIZE`` on purpose,
    so leftover cooks overflow onto existing days (up to 7) rather than opening
    a day that can only be half-staffed. 89 cooks means 14 days, not 15.

    ``TeamGenerator._trim_dates_to_capacity`` applies the same rule at
    generation time, since people can opt out of the cycle after these dates
    were picked. Keep the two in step.
    """
    if eligible is None:
        eligible = eligible_food_team_count()
    return max(1, eligible // TARGET_TEAM_SIZE)


def _latest_cycle_end() -> date | None:
    """The latest cooking date across all existing cycles, if any.

    ISO date strings sort lexicographically in chronological order, so we can
    compare the JSON list entries directly without parsing every value.
    """
    from apps.food.models import FoodTeamCycle  # noqa: PLC0415 — avoid app-loading cycle

    latest: str | None = None
    for cycle in FoodTeamCycle.objects.all():
        if cycle.cooking_dates:
            end = max(cycle.cooking_dates)
            if latest is None or end > latest:
                latest = end
    return date.fromisoformat(latest) if latest else None


def suggested_start_date(today: date | None = None) -> date:
    """First day to start scanning for cooking dates from.

    Starts the day after the latest existing cycle's last cooking date so the
    new period doesn't overlap; falls back to tomorrow when there is no future
    cycle to follow.
    """
    if today is None:
        today = timezone.localdate()
    latest = _latest_cycle_end()
    if latest and latest >= today:
        return latest + timedelta(days=1)
    return today + timedelta(days=1)


def earliest_start_date(today: date | None = None) -> date:
    """The first cooking day a period opened today can still be planned for.

    The deadline has to close ``DEADLINE_DAYS_BEFORE_START`` days before it,
    and not before tomorrow evening, so people have at least a day to answer.
    """
    if today is None:
        today = timezone.localdate()
    return today + timedelta(days=DEADLINE_DAYS_BEFORE_START + 1)


def suggested_wish_deadline(first_cooking_date: date, now: datetime | None = None) -> datetime:
    """A week out, but at the latest 23:59 ``DEADLINE_DAYS_BEFORE_START`` days
    before the first cooking day."""
    if now is None:
        now = timezone.now()
    latest = timezone.make_aware(
        datetime.combine(
            first_cooking_date - timedelta(days=DEADLINE_DAYS_BEFORE_START), time(23, 59)
        )
    )
    return min(now + timedelta(days=WISH_WINDOW_DAYS), latest)


def next_cooking_dates(count: int, start: date | None = None) -> list[str]:
    """The next ``count`` Mon–Thu cooking days from ``start``, skipping closed days."""
    from apps.food.models import ClosedFoodDay  # noqa: PLC0415

    if start is None:
        start = suggested_start_date()

    closed = set(ClosedFoodDay.objects.values_list("date", flat=True))
    dates: list[str] = []
    d = start
    guard = 0
    while len(dates) < count and guard < _SCAN_GUARD:
        guard += 1
        if d.weekday() <= LAST_COOKING_WEEKDAY and d not in closed:
            dates.append(d.isoformat())
        d += timedelta(days=1)
    return dates


def suggest_cycle_name(cooking_dates: list[str]) -> str:
    """A Danish month-range name for a cycle, e.g. ``Madhold maj-juni 2026``."""
    if not cooking_dates:
        return "Madhold"
    months = sorted({date.fromisoformat(d).month for d in cooking_dates})
    year = date.fromisoformat(cooking_dates[0]).year
    return f"Madhold {'-'.join(DANISH_MONTHS[m] for m in months)} {year}"
