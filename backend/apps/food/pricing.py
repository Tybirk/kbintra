"""Date-aware portion pricing.

Prices change over time. Every lookup is anchored to the **meal date**, never to
"today", so cost reports, the economy page and ticket prices for past meals keep
using the prices that were in effect when those meals were served.

Prices live in the `MealPrice` table (editable by food admins). The constants
below are only a safety net for a completely empty table.
"""

from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

# Prices used before the price table existed. Seeded as the baseline row by
# migration 0023, so these are never hit in practice.
FALLBACK_PRICE_ADULT_MEAT = Decimal("37.00")
FALLBACK_PRICE_ADULT_VEG = Decimal("26.00")
FALLBACK_PRICE_CHILD = Decimal("18.00")


@dataclass(frozen=True)
class MealPrices:
    """The three portion prices in effect for a given meal date."""

    adult_meat: Decimal
    adult_veg: Decimal
    child: Decimal

    def total(self, adults_meat: int, adults_veg: int, children: int) -> Decimal:
        return self.adult_meat * adults_meat + self.adult_veg * adults_veg + self.child * children


FALLBACK_PRICES = MealPrices(
    adult_meat=FALLBACK_PRICE_ADULT_MEAT,
    adult_veg=FALLBACK_PRICE_ADULT_VEG,
    child=FALLBACK_PRICE_CHILD,
)


class PriceSchedule:
    """All price sets, ordered by start date, resolvable per meal date.

    Fetch once and reuse when pricing many dates (cost reports loop over houses
    x dates) instead of hitting the DB per lookup.
    """

    def __init__(self, entries: list[tuple[date, MealPrices]]) -> None:
        ordered = sorted(entries, key=lambda e: e[0])
        self._starts = [start for start, _ in ordered]
        self._prices = [prices for _, prices in ordered]

    def for_date(self, meal_date: date) -> MealPrices:
        """Prices in effect on `meal_date` (the latest set starting on or before it)."""
        index = bisect_right(self._starts, meal_date) - 1
        if index < 0:
            return FALLBACK_PRICES
        return self._prices[index]


def get_price_schedule() -> PriceSchedule:
    """Load the full price schedule from the database."""
    from .models import MealPrice

    return PriceSchedule(
        [
            (
                row.effective_from,
                MealPrices(
                    adult_meat=row.price_adult_meat,
                    adult_veg=row.price_adult_veg,
                    child=row.price_child,
                ),
            )
            for row in MealPrice.objects.all()
        ]
    )


def get_prices(meal_date: date) -> MealPrices:
    """Prices in effect for a single meal date."""
    return get_price_schedule().for_date(meal_date)


def calculate_meal_price(
    adults_meat: int,
    adults_veg: int,
    children: int,
    meal_date: date,
) -> Decimal:
    """Calculate the price of a meal from portion counts, using `meal_date` prices."""
    return get_prices(meal_date).total(adults_meat, adults_veg, children)
