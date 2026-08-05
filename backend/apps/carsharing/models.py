"""
Car sharing (bildeling) models.

The app is an overview and a calculator, not an authority that allocates cars: a
loan only exists once an owner has said yes. CarBlock is therefore advisory —
it shapes what the borrower is shown, it does not reserve anything. Only an
ACTIVE CarLoan is a hard fact about a car's whereabouts.
"""

from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from apps.houses.models import Car

from .constants import DEFAULT_RATE_PER_KM


class CarBlock(models.Model):
    """A weekly window where a car is normally in use.

    Advisory only — shown as "normalt optaget" and still selectable, because a
    car that is usually away on Tuesdays may well be free this Tuesday.
    """

    class DayOfWeek(models.IntegerChoices):
        MONDAY = 0, "Mandag"
        TUESDAY = 1, "Tirsdag"
        WEDNESDAY = 2, "Onsdag"
        THURSDAY = 3, "Torsdag"
        FRIDAY = 4, "Fredag"
        SATURDAY = 5, "Lørdag"
        SUNDAY = 6, "Søndag"

    car = models.ForeignKey(Car, on_delete=models.CASCADE, related_name="blocks")
    # Same representation as bookings.RecurringBooking.days_of_week.
    days_of_week = models.JSONField(
        default=list, help_text="List of day integers (0=Monday, 6=Sunday)"
    )
    start_time = models.TimeField()
    end_time = models.TimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["start_time"]

    def __str__(self) -> str:
        return f"{self.car} {self.days_of_week_display} {self.start_time}-{self.end_time}"

    @property
    def days_of_week_display(self) -> str:
        return ", ".join(self.DayOfWeek(d).label for d in sorted(self.days_of_week))

    def clean(self) -> None:
        super().clean()
        if self.start_time and self.end_time and self.start_time >= self.end_time:
            # Blocks across midnight are split in two; a commuter schedule
            # (07-16) never reaches midnight, so this costs nothing real.
            raise ValidationError({"end_time": "Sluttidspunktet skal være efter starttidspunktet."})
        days = self.days_of_week or []
        if not days:
            raise ValidationError({"days_of_week": "Vælg mindst én ugedag."})
        valid = {choice.value for choice in self.DayOfWeek}
        if any(day not in valid for day in days):
            raise ValidationError({"days_of_week": "Ugyldig ugedag."})

    def covers_weekday(self, weekday: int) -> bool:
        return weekday in (self.days_of_week or [])


class CarLoan(models.Model):
    """A request that becomes the loan itself the moment an owner says yes.

    One row for the whole lifecycle, so the state machine stays in one place
    rather than being split across a request table and a loan table.

    First yes wins: the borrower already chose which cars to ask, so any of them
    is acceptable and there is nothing left to decide afterwards.
    """

    class Status(models.TextChoices):
        REQUESTED = "requested", "Forespurgt"
        ACTIVE = "active", "Aktivt"
        COMPLETED = "completed", "Afsluttet"
        CANCELLED = "cancelled", "Aflyst"
        # Every asked household said no. A terminal state rather than a derived
        # "all candidates declined" check, so a dead request leaves the open list
        # and stops counting as an unanswered request against the car.
        DECLINED = "declined", "Ingen kunne låne ud"

    borrower = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="car_loans"
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.REQUESTED, db_index=True
    )
    start_at = models.DateTimeField()
    end_at = models.DateTimeField()
    expected_km = models.PositiveIntegerField()
    needs_isofix = models.BooleanField(default=False)
    needs_tow_hitch = models.BooleanField(default=False)
    min_seats = models.PositiveSmallIntegerField(null=True, blank=True)
    note = models.TextField(blank=True, default="")
    # The terms the borrower ticked when sending the request.
    terms_version = models.CharField(max_length=20)
    # And the terms the lending household had accepted, copied from the car when
    # the loan started. Snapshotted for the same reason as rate_per_km: the car's
    # own value moves on, and a settled loan must stay answerable afterwards.
    owner_terms_version = models.CharField(max_length=20, blank=True, default="")

    # Filled in when the first owner says yes (REQUESTED → ACTIVE).
    car = models.ForeignKey(
        Car, on_delete=models.PROTECT, null=True, blank=True, related_name="loans"
    )
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="approved_car_loans",
    )
    # Snapshot: a later rate change must not rewrite historical loans.
    rate_per_km = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    activated_at = models.DateTimeField(null=True, blank=True)

    # Filled in at completion (ACTIVE → COMPLETED).
    actual_km = models.PositiveIntegerField(null=True, blank=True)
    expense_amount = models.DecimalField(max_digits=7, decimal_places=2, default=Decimal("0"))
    expense_note = models.CharField(max_length=200, blank=True, default="")
    damage_note = models.TextField(blank=True, default="")
    amount_due = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.borrower} {self.start_at:%d-%m-%Y %H:%M} ({self.get_status_display()})"

    def clean(self) -> None:
        super().clean()
        if self.start_at and self.end_at and self.end_at <= self.start_at:
            raise ValidationError({"end_at": "Lånet skal slutte efter det starter."})

    @property
    def effective_rate(self) -> Decimal:
        """The snapshotted rate, falling back to the shared default."""
        return self.rate_per_km if self.rate_per_km is not None else DEFAULT_RATE_PER_KM

    def calculate_amount_due(self) -> Decimal:
        """km * rate − the borrower's own charging/fuel expenses.

        May be negative: then the owner owes the borrower, and the UI has to say
        so plainly rather than hiding a minus sign.
        """
        km = self.actual_km or 0
        expenses = self.expense_amount or Decimal("0")
        return (km * self.effective_rate - expenses).quantize(Decimal("0.01"))


class CarLoanCandidate(models.Model):
    """One car the borrower asked about.

    Exactly one candidate can end up ACCEPTED: the first owner to say yes lends
    their car out then and there, and the rest are CLOSED without having to do
    anything. A slower owner is not rejected — just no longer needed.
    """

    class Status(models.TextChoices):
        ASKED = "asked", "Spurgt"
        ACCEPTED = "accepted", "Accepteret"
        DECLINED = "declined", "Afvist"
        CLOSED = "closed", "En anden ejer var først"

    loan = models.ForeignKey(CarLoan, on_delete=models.CASCADE, related_name="candidates")
    car = models.ForeignKey(Car, on_delete=models.CASCADE, related_name="loan_candidacies")
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.ASKED, db_index=True
    )
    responded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="car_loan_responses",
    )
    responded_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(fields=["loan", "car"], name="unique_loan_car_candidate")
        ]

    def __str__(self) -> str:
        return f"{self.car} → {self.loan_id} ({self.get_status_display()})"
