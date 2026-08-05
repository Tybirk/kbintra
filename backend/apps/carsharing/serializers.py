"""
Serializers for the car sharing (bildeling) app.
"""

import datetime
from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers

from apps.houses.models import Car
from apps.houses.serializers import CAR_SPEC_FIELDS

from .constants import (
    MAX_BLOCKS_PER_CAR,
    MAX_CANDIDATES_PER_LOAN,
    MAX_LOAN_DAYS,
    TERMS_VERSION,
)
from .models import CarBlock, CarLoan, CarLoanCandidate
from .roles import LoanRole, can_cancel, loan_role
from .services import borrowable_cars


class CarBlockSerializer(serializers.ModelSerializer):
    """A weekly window where the car is normally in use."""

    days_of_week_display = serializers.CharField(read_only=True)

    class Meta:
        model = CarBlock
        fields = [
            "id",
            "car",
            "days_of_week",
            "days_of_week_display",
            "start_time",
            "end_time",
        ]
        read_only_fields = ["id", "car"]

    def validate(self, attrs):
        instance = CarBlock(
            days_of_week=attrs.get("days_of_week", []),
            start_time=attrs.get("start_time"),
            end_time=attrs.get("end_time"),
        )
        instance.clean()
        return attrs


class CarBlockReplaceSerializer(serializers.Serializer):
    """The whole weekly schedule at once.

    The painting grid produces a complete schedule rather than one window at a
    time, so it is replaced in one transaction — otherwise a half-applied set of
    deletes and creates would leave the car with a schedule nobody chose.
    """

    blocks = CarBlockSerializer(many=True)

    def validate_blocks(self, value):
        if len(value) > MAX_BLOCKS_PER_CAR:
            raise serializers.ValidationError(
                f"Et ugeskema kan højst have {MAX_BLOCKS_PER_CAR} tidsrum."
            )
        return value


class SharedCarSerializer(serializers.ModelSerializer):
    """A shared car as the borrower sees it, including why it may look busy."""

    display_name = serializers.CharField(read_only=True)
    house_name = serializers.CharField(source="house.name", read_only=True)
    house_slug = serializers.CharField(source="house.slug", read_only=True)
    effective_rate_per_km = serializers.SerializerMethodField()
    conflict = serializers.SerializerMethodField()
    conflict_note = serializers.SerializerMethodField()
    meets_requirements = serializers.SerializerMethodField()
    selectable = serializers.SerializerMethodField()
    blocks = CarBlockSerializer(many=True, read_only=True)

    class Meta:
        model = Car
        fields = [
            "id",
            "display_name",
            "license_plate",
            "house_name",
            "house_slug",
            "is_electric",
            *CAR_SPEC_FIELDS,
            "effective_rate_per_km",
            "blocks",
            "conflict",
            "conflict_note",
            "meets_requirements",
            "selectable",
        ]

    def _availability(self, car):
        return (self.context.get("availability") or {}).get(car.id)

    def get_effective_rate_per_km(self, car) -> str:
        from .services import rate_for_car

        return str(rate_for_car(car))

    def get_conflict(self, car) -> str | None:
        availability = self._availability(car)
        return availability.conflict if availability else None

    def get_conflict_note(self, car) -> str:
        availability = self._availability(car)
        return availability.conflict_note if availability else ""

    def get_meets_requirements(self, car) -> bool:
        availability = self._availability(car)
        return availability.meets_requirements if availability else True

    def get_selectable(self, car) -> bool:
        availability = self._availability(car)
        return availability.selectable if availability else True


class CarLoanCandidateSerializer(serializers.ModelSerializer):
    """One asked car on a loan request."""

    car_display_name = serializers.CharField(source="car.display_name", read_only=True)
    car_house_name = serializers.CharField(source="car.house.name", read_only=True)
    responded_by_name = serializers.SerializerMethodField()
    is_own_household = serializers.SerializerMethodField()

    class Meta:
        model = CarLoanCandidate
        fields = [
            "id",
            "car",
            "car_display_name",
            "car_house_name",
            "status",
            "responded_by_name",
            "responded_at",
            "is_own_household",
        ]
        read_only_fields = fields

    def get_is_own_household(self, candidate) -> bool:
        """Whether the current user may answer for this car.

        A loan is visible to every asked household, so without this the UI would
        offer accept/decline for other households' cars — the server rejects
        those, but the button should not be there in the first place.
        """
        request = self.context.get("request")
        house_id = getattr(request.user, "house_id", None) if request else None
        return bool(house_id and candidate.car.house_id == house_id)

    def get_responded_by_name(self, candidate) -> str:
        """Which *person* answered — for the borrower and that household only.

        Whether a car is available is everyone's business; which neighbour picked
        up their phone is not. Other asked households still see the car and the
        answer, just not the name behind it.
        """
        if candidate.responded_by is None:
            return ""
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user is None:
            return ""
        if user.id == candidate.loan.borrower_id or self.get_is_own_household(candidate):
            return candidate.responded_by.first_name
        return ""


class CarLoanSerializer(serializers.ModelSerializer):
    """A loan request, and — once an owner says yes — the loan itself.

    Everything a viewer is allowed to know depends on their role, which the server
    decides (see roles.py) rather than leaving the client to infer from status
    flags. The private fields below are method fields for the same reason: a
    household that lost the race or said no is not party to the loan, and hiding
    the key location or the settlement in React would still have shipped it.
    """

    borrower_name = serializers.SerializerMethodField()
    car_display_name = serializers.CharField(source="car.display_name", read_only=True, default="")
    car_house_name = serializers.CharField(source="car.house.name", read_only=True, default="")
    candidates = CarLoanCandidateSerializer(many=True, read_only=True)
    is_borrower = serializers.SerializerMethodField()
    viewer_role = serializers.SerializerMethodField()
    can_cancel = serializers.SerializerMethodField()
    has_started = serializers.SerializerMethodField()

    # Only for the two households actually party to the loan.
    car_practical_note = serializers.SerializerMethodField()
    actual_km = serializers.SerializerMethodField()
    expense_amount = serializers.SerializerMethodField()
    expense_note = serializers.SerializerMethodField()
    damage_note = serializers.SerializerMethodField()
    amount_due = serializers.SerializerMethodField()

    class Meta:
        model = CarLoan
        fields = [
            "id",
            "borrower",
            "borrower_name",
            "is_borrower",
            "viewer_role",
            "can_cancel",
            "has_started",
            "status",
            "start_at",
            "end_at",
            "expected_km",
            "needs_isofix",
            "needs_tow_hitch",
            "min_seats",
            "note",
            "terms_version",
            "owner_terms_version",
            "car",
            "car_display_name",
            "car_house_name",
            "car_practical_note",
            "rate_per_km",
            "activated_at",
            "actual_km",
            "expense_amount",
            "expense_note",
            "damage_note",
            "amount_due",
            "completed_at",
            "candidates",
            "created_at",
        ]
        read_only_fields = fields

    def _viewer(self):
        request = self.context.get("request")
        return getattr(request, "user", None)

    def _role(self, loan) -> str:
        """The viewer's role, worked out once per loan.

        Seven fields below need it, and recomputing it seven times per row is
        pure waste — it walks the prefetched candidates each time.
        """
        cache = self.context.setdefault("_loan_roles", {})
        if loan.pk not in cache:
            viewer = self._viewer()
            cache[loan.pk] = loan_role(loan, viewer) if viewer else LoanRole.NONE
        return cache[loan.pk]

    def _is_party(self, loan) -> bool:
        """The borrower and the lending household, and nobody else."""
        return self._role(loan) in (LoanRole.BORROWER, LoanRole.LENDER)

    def get_borrower_name(self, loan) -> str:
        return f"{loan.borrower.first_name} {loan.borrower.last_name}".strip()

    def get_is_borrower(self, loan) -> bool:
        viewer = self._viewer()
        return bool(viewer and viewer.id == loan.borrower_id)

    def get_viewer_role(self, loan) -> str:
        return self._role(loan)

    def get_can_cancel(self, loan) -> bool:
        viewer = self._viewer()
        return bool(viewer and can_cancel(loan, viewer))

    def get_has_started(self, loan) -> bool:
        """Whether the borrowed window has begun.

        Server-side rather than a client-side clock comparison: a phone with a
        wrong clock must not unlock the settlement form for a trip that has not
        happened.
        """
        return timezone.now() >= loan.start_at

    def get_car_practical_note(self, loan) -> str:
        if loan.car_id is None or not self._is_party(loan):
            return ""
        return loan.car.practical_note

    def get_actual_km(self, loan) -> int | None:
        return loan.actual_km if self._is_party(loan) else None

    def get_expense_amount(self, loan) -> str | None:
        return str(loan.expense_amount) if self._is_party(loan) else None

    def get_expense_note(self, loan) -> str:
        return loan.expense_note if self._is_party(loan) else ""

    def get_damage_note(self, loan) -> str:
        return loan.damage_note if self._is_party(loan) else ""

    def get_amount_due(self, loan) -> str | None:
        if loan.amount_due is None or not self._is_party(loan):
            return None
        return str(loan.amount_due)


class CarLoanCreateSerializer(serializers.Serializer):
    """Creating a request: a window, expectations, and the cars to ask."""

    start_at = serializers.DateTimeField()
    end_at = serializers.DateTimeField()
    expected_km = serializers.IntegerField(min_value=1, max_value=100_000)
    car_ids = serializers.ListField(child=serializers.IntegerField(), allow_empty=False)
    needs_isofix = serializers.BooleanField(required=False, default=False)
    needs_tow_hitch = serializers.BooleanField(required=False, default=False)
    min_seats = serializers.IntegerField(required=False, allow_null=True, min_value=1, max_value=9)
    note = serializers.CharField(required=False, allow_blank=True, default="")
    # Required rather than defaulting to False, so a client that forgets the field
    # is told to fix it instead of quietly sending an unconfirmed request.
    accepted_terms = serializers.BooleanField()

    def validate_accepted_terms(self, value):
        if not value:
            raise serializers.ValidationError(
                "Du skal bekræfte at du har læst vilkårene, før du kan låne en bil."
            )
        return value

    def validate(self, attrs):
        start_at, end_at = attrs["start_at"], attrs["end_at"]
        if end_at <= start_at:
            raise serializers.ValidationError({"end_at": "Lånet skal slutte efter det starter."})
        if end_at - start_at > datetime.timedelta(days=MAX_LOAN_DAYS):
            raise serializers.ValidationError(
                {"end_at": f"Et lån kan højst vare {MAX_LOAN_DAYS} dage."}
            )
        if end_at < timezone.now():
            raise serializers.ValidationError({"end_at": "Tidsrummet ligger i fortiden."})

        car_ids = list(dict.fromkeys(attrs["car_ids"]))
        if len(car_ids) > MAX_CANDIDATES_PER_LOAN:
            raise serializers.ValidationError(
                {
                    "car_ids": (
                        f"Du kan højst spørge {MAX_CANDIDATES_PER_LOAN} biler ad gangen — "
                        "vælg de mest relevante."
                    )
                }
            )

        user = self.context["request"].user
        cars = list(borrowable_cars().filter(id__in=car_ids).select_related("house"))
        if len(cars) != len(car_ids):
            raise serializers.ValidationError(
                {"car_ids": "En eller flere biler er ikke i delebilparken."}
            )
        if user.house_id and any(car.house_id == user.house_id for car in cars):
            raise serializers.ValidationError(
                {"car_ids": "Du behøver ikke forespørge om din egen husstands bil."}
            )

        attrs["car_ids"] = car_ids
        attrs["cars"] = cars
        return attrs

    def create(self, validated_data):
        cars = validated_data.pop("cars")
        validated_data.pop("car_ids")
        # Consent is recorded as terms_version on the loan, not as a column of
        # its own; the tick itself has served its purpose once validated.
        validated_data.pop("accepted_terms")
        loan = CarLoan.objects.create(
            borrower=self.context["request"].user,
            terms_version=TERMS_VERSION,
            **validated_data,
        )
        CarLoanCandidate.objects.bulk_create([CarLoanCandidate(loan=loan, car=car) for car in cars])
        return loan


class CandidateRespondSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=["accept", "decline"])


class CompleteLoanSerializer(serializers.Serializer):
    actual_km = serializers.IntegerField(
        min_value=0,
        max_value=100_000,
        error_messages={
            "invalid": "Skriv antal kilometer som et helt tal.",
            "min_value": "Kilometer kan ikke være negativt.",
        },
    )
    # min_value is not decoration: without it a negative expense *raises* the
    # borrower's own bill (km × rate − (−x)), and the preview hid the term because
    # it only rendered when the amount was above zero.
    expense_amount = serializers.DecimalField(
        max_digits=7,
        decimal_places=2,
        required=False,
        default=0,
        min_value=Decimal("0"),
        error_messages={
            "invalid": "Skriv kun et beløb, fx 50,50.",
            "min_value": "Udgiften kan ikke være negativ.",
        },
    )
    expense_note = serializers.CharField(required=False, allow_blank=True, default="")
    damage_note = serializers.CharField(required=False, allow_blank=True, default="")
