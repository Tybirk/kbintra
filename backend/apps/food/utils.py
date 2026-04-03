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
