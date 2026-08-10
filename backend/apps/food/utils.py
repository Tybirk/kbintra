"""Utility functions for the food app."""

from datetime import date


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
