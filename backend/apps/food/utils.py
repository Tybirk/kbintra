"""Utility functions for the food app."""

import re
from datetime import date


def house_number_for(house) -> str:  # type: ignore[no-untyped-def]
    """The bare house number to show beside a cook's name (e.g. "45").

    Houses are named after the street ("Kløverbakkevej 45") and slugged by their
    number, so the slug is the answer whenever it is set. Fall back to the last
    number in the name, and to the name itself if there is no number at all —
    the food-team UI prints this straight after the word "Hus", so it must never
    come out as the whole address.
    """
    if house is None:
        return ""
    slug = (house.slug or "").strip()
    if slug:
        return slug[:20]
    numbers = re.findall(r"\d+", house.name or "")
    return (numbers[-1] if numbers else (house.name or "").strip())[:20]


def housemates_of(user):  # type: ignore[no-untyped-def]
    """The other active residents of this user's house, by first name.

    "Household" is simply the house here — that is the only grouping the app
    has, and it is what "min medbeboer" has always meant in the food team UI.
    Returns an empty queryset for someone without a house, or living alone.
    """
    from apps.users.models import User

    if not user.house_id:
        return User.objects.none()
    return (
        User.objects.filter(house_id=user.house_id, is_active=True)
        .exclude(pk=user.pk)
        .order_by("first_name")
    )


def get_closed_food_dates(dates: list[date]) -> set[date]:
    """Return the subset of ``dates`` that are closed food days."""
    from .models import ClosedFoodDay

    return set(ClosedFoodDay.objects.filter(date__in=dates).values_list("date", flat=True))


def is_closed_food_day(d: date) -> bool:
    """Check if a single date is a closed food day."""
    from .models import ClosedFoodDay

    return ClosedFoodDay.objects.filter(date=d).exists()


def membership_swap_conflict(membership_a, membership_b) -> str | None:  # type: ignore[no-untyped-def]
    """Danish error if swapping these two memberships would double-book someone.

    ``FoodTeamMember`` is unique per (team, user), and a takeover deliberately
    leaves the taker on two teams in a cycle. So a later swap can try to move
    someone onto a team they already cook on, which would raise IntegrityError
    halfway through the transaction. Check it up front and return a real error
    instead. Same-team swaps hit the same constraint on the first save (the
    partner still holds the row we are moving into), so they are rejected too.

    Returns ``None`` when the swap is safe.
    """
    from django.db.models import Q

    from .models import FoodTeamMember

    if membership_a.team_id == membership_b.team_id:
        return "I laver allerede mad på samme dag."

    clashes = (
        FoodTeamMember.objects.filter(
            Q(team_id=membership_a.team_id, user_id=membership_b.user_id)
            | Q(team_id=membership_b.team_id, user_id=membership_a.user_id)
        )
        .exclude(pk__in=[membership_a.pk, membership_b.pk])
        .exists()
    )
    if clashes:
        return "Byttet kan ikke gennemføres: en af jer laver allerede mad den anden dag."
    return None
