"""
Availability for the car pool.

Three grades of "busy", deliberately not treated alike (see docs/bildeling-plan.md):
an active loan is a fact, the weekly schedule is a guess, and someone else's
unanswered request is neither — it is information.
"""

import datetime
from dataclasses import dataclass

from django.db.models import Prefetch
from django.utils import timezone

from apps.houses.models import Car

from .constants import DEFAULT_RATE_PER_KM
from .models import CarBlock, CarLoan, CarLoanCandidate

# Ordering weight per conflict kind: free cars first, lent-out cars last.
CONFLICT_ORDER = {None: 0, "requested": 1, "schedule": 2, "loan": 3}


@dataclass
class CarAvailability:
    """A pool car plus why it might look busy in the requested window."""

    car: Car
    conflict: str | None
    conflict_note: str
    meets_requirements: bool

    @property
    def selectable(self) -> bool:
        """Only a real, active loan takes a car off the table."""
        return self.conflict != "loan"


def _local_window(start_at: datetime.datetime, end_at: datetime.datetime):
    """Convert an aware window to local wall-clock time.

    CarBlock stores weekday + wall-clock time (Europe/Copenhagen) while loans are
    stored as UTC. Comparing them without converting first is wrong by the UTC
    offset, and flips the weekday for anything near midnight. Same approach as
    apps/bookings/validators.py.
    """
    return timezone.localtime(start_at), timezone.localtime(end_at)


def schedule_conflict(
    blocks: list[CarBlock],
    start_at: datetime.datetime,
    end_at: datetime.datetime,
) -> CarBlock | None:
    """First weekly block overlapping the window, or None."""
    if not blocks:
        return None

    start_local, end_local = _local_window(start_at, end_at)
    tz = timezone.get_current_timezone()

    day = start_local.date()
    last_day = end_local.date()
    while day <= last_day:
        for block in blocks:
            if not block.covers_weekday(day.weekday()):
                continue
            block_start = timezone.make_aware(datetime.datetime.combine(day, block.start_time), tz)
            block_end = timezone.make_aware(datetime.datetime.combine(day, block.end_time), tz)
            # Half-open overlap: a block ending at 12 and a loan starting at 12
            # do not collide.
            if block_start < end_at and block_end > start_at:
                return block
        day += datetime.timedelta(days=1)
    return None


def active_loan_conflict(car_id: int, start_at, end_at, *, exclude_loan_id: int | None = None):
    """An ACTIVE loan overlapping the window — the only hard conflict."""
    qs = CarLoan.objects.filter(
        car_id=car_id,
        status=CarLoan.Status.ACTIVE,
        start_at__lt=end_at,
        end_at__gt=start_at,
    )
    if exclude_loan_id is not None:
        qs = qs.exclude(pk=exclude_loan_id)
    return qs.first()


def has_open_request(car_id: int, start_at, end_at, *, exclude_loan_id: int | None = None) -> bool:
    """Whether someone else has an unanswered request out on this car.

    Goes through the candidate table on purpose: a REQUESTED loan has car=NULL
    until the borrower chooses, so filtering CarLoan.car would never match.
    """
    qs = CarLoanCandidate.objects.filter(
        car_id=car_id,
        status=CarLoanCandidate.Status.ASKED,
        loan__status=CarLoan.Status.REQUESTED,
        loan__start_at__lt=end_at,
        loan__end_at__gt=start_at,
    )
    if exclude_loan_id is not None:
        qs = qs.exclude(loan_id=exclude_loan_id)
    return qs.exists()


def pool_cars_with_availability(
    start_at: datetime.datetime,
    end_at: datetime.datetime,
    *,
    needs_isofix: bool = False,
    needs_tow_hitch: bool = False,
    min_seats: int | None = None,
    exclude_house_id: int | None = None,
    exclude_loan_id: int | None = None,
) -> list[CarAvailability]:
    """Every pool car, each marked with why it may look busy.

    Returns them all — including lent-out ones — so the borrower can see *why* a
    car is not an option instead of it simply being absent. Requirements
    (isofix/tow hitch/seats) never filter hard; they sort and mark.
    """
    cars = (
        Car.objects.filter(in_pool=True)
        .select_related("house")
        .prefetch_related(Prefetch("blocks", queryset=CarBlock.objects.all()))
    )
    if exclude_house_id is not None:
        # You do not request your own household's car.
        cars = cars.exclude(house_id=exclude_house_id)

    results: list[CarAvailability] = []
    for car in cars:
        conflict: str | None = None
        note = ""

        loan = active_loan_conflict(car.id, start_at, end_at, exclude_loan_id=exclude_loan_id)
        if loan is not None:
            conflict, note = "loan", "Udlånt i tidsrummet"
        else:
            block = schedule_conflict(list(car.blocks.all()), start_at, end_at)
            if block is not None:
                conflict = "schedule"
                note = "Normalt optaget"
            elif has_open_request(car.id, start_at, end_at, exclude_loan_id=exclude_loan_id):
                conflict = "requested"
                note = "Der er allerede spurgt om denne bil i tidsrummet"

        meets = True
        if needs_isofix and not car.has_isofix:
            meets = False
        if needs_tow_hitch and not car.has_tow_hitch:
            meets = False
        if min_seats is not None and (car.seats is None or car.seats < min_seats):
            meets = False

        results.append(
            CarAvailability(
                car=car, conflict=conflict, conflict_note=note, meets_requirements=meets
            )
        )

    results.sort(
        key=lambda item: (
            not item.meets_requirements,
            CONFLICT_ORDER[item.conflict],
            item.car.display_name.lower(),
        )
    )
    return results


def rate_for_car(car: Car):
    """The rate to snapshot onto a loan when it is activated."""
    return car.rate_per_km if car.rate_per_km is not None else DEFAULT_RATE_PER_KM
