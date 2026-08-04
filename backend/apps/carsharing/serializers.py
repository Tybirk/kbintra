"""
Serializers for the car sharing (bildeling) app.
"""

import datetime

from django.utils import timezone
from rest_framework import serializers

from apps.houses.models import Car

from .constants import (
    MAX_BLOCKS_PER_CAR,
    MAX_CANDIDATES_PER_LOAN,
    MAX_LOAN_DAYS,
    TERMS_VERSION,
)
from .models import CarBlock, CarLoan, CarLoanCandidate


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


class PoolCarSerializer(serializers.ModelSerializer):
    """A pool car as the borrower sees it, including why it may look busy."""

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
            "make",
            "model_name",
            "color",
            "year",
            "seats",
            "has_tow_hitch",
            "has_isofix",
            "dogs_allowed",
            "has_charge_fob",
            "equipment_note",
            "practical_note",
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
    responded_by_name = serializers.CharField(
        source="responded_by.first_name", read_only=True, default=""
    )
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


class CarLoanSerializer(serializers.ModelSerializer):
    """A loan request, and — once a car is chosen — the loan itself."""

    borrower_name = serializers.SerializerMethodField()
    car_display_name = serializers.CharField(source="car.display_name", read_only=True, default="")
    car_house_name = serializers.CharField(source="car.house.name", read_only=True, default="")
    car_practical_note = serializers.CharField(
        source="car.practical_note", read_only=True, default=""
    )
    candidates = CarLoanCandidateSerializer(many=True, read_only=True)
    is_borrower = serializers.SerializerMethodField()

    class Meta:
        model = CarLoan
        fields = [
            "id",
            "borrower",
            "borrower_name",
            "is_borrower",
            "status",
            "start_at",
            "end_at",
            "expected_km",
            "needs_isofix",
            "needs_tow_hitch",
            "min_seats",
            "note",
            "terms_version",
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

    def get_borrower_name(self, loan) -> str:
        return f"{loan.borrower.first_name} {loan.borrower.last_name}".strip()

    def get_is_borrower(self, loan) -> bool:
        request = self.context.get("request")
        return bool(request and request.user.id == loan.borrower_id)


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
        cars = list(Car.objects.filter(id__in=car_ids, in_pool=True).select_related("house"))
        if len(cars) != len(car_ids):
            raise serializers.ValidationError(
                {"car_ids": "En eller flere biler er ikke i bilpølen."}
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
        loan = CarLoan.objects.create(
            borrower=self.context["request"].user,
            terms_version=TERMS_VERSION,
            **validated_data,
        )
        CarLoanCandidate.objects.bulk_create([CarLoanCandidate(loan=loan, car=car) for car in cars])
        return loan


class CandidateRespondSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=["accept", "decline"])


class ChooseCandidateSerializer(serializers.Serializer):
    candidate = serializers.IntegerField()


class CompleteLoanSerializer(serializers.Serializer):
    actual_km = serializers.IntegerField(min_value=0, max_value=100_000)
    expense_amount = serializers.DecimalField(
        max_digits=7, decimal_places=2, required=False, default=0
    )
    expense_note = serializers.CharField(required=False, allow_blank=True, default="")
    damage_note = serializers.CharField(required=False, allow_blank=True, default="")
