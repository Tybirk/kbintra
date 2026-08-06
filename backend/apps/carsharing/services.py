"""
Availability for the delebilpark.

Three grades of "busy", deliberately not treated alike (see docs/bildeling-plan.md):
an active loan is a fact, the weekly schedule is a guess, and someone else's
unanswered request is neither — it is information.
"""

import datetime
from dataclasses import dataclass

from django.db.models import Prefetch, Q
from django.utils import timezone

from apps.houses.models import Car

from .constants import DEFAULT_RATE_PER_KM, TERMS_VERSION
from .models import CarBlock, CarLoan, CarLoanCandidate

# Ordering weight per conflict kind: free cars first, lent-out cars last.
CONFLICT_ORDER = {None: 0, "requested": 1, "schedule": 2, "loan": 3}


def borrowable_cars():
    """The cars that may actually be lent out right now.

    is_shared is the owner's intent and terms_accepted_version is their consent;
    lending needs both, and this is the single place that says so — the borrow
    list and the request validation must never disagree about it.
    """
    return Car.objects.filter(is_shared=True, terms_accepted_version=TERMS_VERSION)


def visible_loans(user):
    """Loans this user may see: their own, plus requests aimed at their household.

    Shared by the list and the detail view so a change in who may see a loan
    cannot land in one of them and be forgotten in the other.
    """
    visible = Q(borrower=user)
    if user.house_id:
        visible |= Q(candidates__car__house_id=user.house_id)
    return (
        CarLoan.objects.filter(visible)
        .select_related("borrower", "car", "car__house")
        .prefetch_related("candidates__car__house")
        .distinct()
    )


@dataclass
class CarAvailability:
    """A shared car plus why it might look busy in the requested window."""

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
    until an owner accepts, so filtering CarLoan.car would never match.
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


def shared_cars_with_availability(
    start_at: datetime.datetime,
    end_at: datetime.datetime,
    *,
    needs_isofix: bool = False,
    needs_tow_hitch: bool = False,
    min_seats: int | None = None,
    exclude_house_id: int | None = None,
    exclude_loan_id: int | None = None,
) -> list[CarAvailability]:
    """Every shared car, each marked with why it may look busy.

    Returns them all — including lent-out ones — so the borrower can see *why* a
    car is not an option instead of it simply being absent. Requirements
    (isofix/tow hitch/seats) never filter hard; they sort and mark.
    """
    cars = (
        borrowable_cars()
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
            asked = has_open_request(car.id, start_at, end_at, exclude_loan_id=exclude_loan_id)
            if block is not None:
                conflict = "schedule"
                # The badge already says "Normalt optaget"; repeating it here told
                # the borrower nothing the badge had not, so say what it means for
                # them instead — that the schedule is a guess they may override.
                note = "Bilen plejer at være i brug her, men spørg endelig"
                # A real, concrete request used to be hidden behind the advisory
                # schedule because this was an if/elif on the same slot.
                if asked:
                    note += ". Der er også allerede spurgt om den i tidsrummet"
            elif asked:
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


def close_loan_if_unanswerable(loan) -> bool:
    """Finish a request that nobody can answer any more.

    A REQUESTED loan with no ASKED candidate left is over: leaving it open makes
    the borrower wait for households that have nothing left to say. Both ways a
    candidate can stop being answerable — a household declining, and a car being
    removed from the delebilpark — go through here, so the rule cannot end up
    implemented twice and differently.
    """
    if loan.candidates.filter(status=CarLoanCandidate.Status.ASKED).exists():
        return False
    return bool(
        CarLoan.objects.filter(pk=loan.pk, status=CarLoan.Status.REQUESTED).update(
            status=CarLoan.Status.DECLINED
        )
    )


def withdraw_car_from_open_requests(car: Car, *, by_user) -> list:
    """Answer, on a departing car's behalf, every request still waiting on it.

    Removing a car cascades its candidacies away. Without this the borrower is
    left waiting on a household that no longer has anything to answer with — an
    open request with a blank "Spurgt:" line and nobody who can end it.

    Removal is treated as that household saying no, because that is what it means
    to the borrower. Returns the candidates as they were answered, so the caller
    can notify from them after the delete has actually gone through.
    """
    candidates = list(
        CarLoanCandidate.objects.select_related(
            "loan", "loan__borrower", "car", "car__house"
        ).filter(
            car=car,
            status=CarLoanCandidate.Status.ASKED,
            loan__status=CarLoan.Status.REQUESTED,
        )
    )
    if not candidates:
        return []

    CarLoanCandidate.objects.filter(pk__in=[item.pk for item in candidates]).update(
        status=CarLoanCandidate.Status.DECLINED,
        responded_by=by_user,
        responded_at=timezone.now(),
    )
    for candidate in candidates:
        candidate.status = CarLoanCandidate.Status.DECLINED
        candidate.responded_by = by_user
        close_loan_if_unanswerable(candidate.loan)
    return candidates
