"""
Serializers for Food models.
"""

from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any

from django.db.models import Sum
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework import serializers

from apps.users.models import User
from apps.users.serializer_mixins import AvatarUrlMixin

from .constants import (
    DAY_NAMES,
    TICKET_SALE_CUTOFF_TIME,
)
from .models import (
    BroadcastStatus,
    ClosedFoodDay,
    CycleStatus,
    DriveMenuCache,
    FoodTeam,
    FoodTeamCycle,
    FoodTeamMember,
    FoodTeamWish,
    FoodTicket,
    MealPreference,
    MealPrice,
    MealRegistration,
    SwapBroadcast,
    SwapRequestStatus,
    TeamFavour,
    TeamSwapRequest,
)


def get_registration_deadline(meal_date: date) -> datetime:
    """Get the registration deadline for a meal date.

    The deadline is Wednesday 23:59:59 of the week before the meal.
    """
    # Calculate Wednesday of the previous week
    # meal_date.weekday(): 0=Mon, 1=Tue, 2=Wed, 3=Thu
    # We need to go back to the previous week's Wednesday
    days_to_prev_wednesday = meal_date.weekday() + 5  # Mon=5, Tue=6, Wed=7, Thu=8
    deadline_date = meal_date - timedelta(days=days_to_prev_wednesday)
    deadline_time = time(23, 59, 59)
    return datetime.combine(deadline_date, deadline_time, tzinfo=timezone.get_current_timezone())


def is_after_deadline(meal_date: date) -> bool:
    """Return True if the registration deadline for meal_date has passed."""
    return timezone.now() >= get_registration_deadline(meal_date)


class AuthorSerializer(AvatarUrlMixin, serializers.ModelSerializer):
    """Minimal serializer for user info."""

    class Meta:
        model = User
        fields = ["id", "first_name", "last_name", "profile_picture", "phone_number"]


class MealPreferenceSerializer(serializers.ModelSerializer):
    """Serializer for MealPreference model."""

    day_name = serializers.CharField(source="get_day_of_week_display", read_only=True)

    class Meta:
        model = MealPreference
        fields = [
            "id",
            "day_of_week",
            "day_name",
            "adults_meat",
            "adults_veg",
            "children_count",
            "dining_option",
            "seating_time",
        ]


class MealPreferenceCreateUpdateSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating meal preferences."""

    class Meta:
        model = MealPreference
        fields = [
            "day_of_week",
            "adults_meat",
            "adults_veg",
            "children_count",
            "dining_option",
            "seating_time",
        ]

    def validate(self, attrs: dict) -> dict:
        day_of_week = attrs.get("day_of_week") or (
            self.instance.day_of_week if self.instance else None
        )
        adults_meat = attrs.get("adults_meat", 0)

        if day_of_week is not None and day_of_week != 2 and adults_meat > 0:
            raise serializers.ValidationError({"adults_meat": "Kød serveres kun om onsdagen."})

        return attrs

    def create(self, validated_data: dict) -> MealPreference:
        user = self.context["request"].user
        validated_data["house"] = user.house
        validated_data["last_modified_by"] = user
        return super().create(validated_data)

    def update(self, instance: MealPreference, validated_data: dict) -> MealPreference:
        validated_data["last_modified_by"] = self.context["request"].user
        return super().update(instance, validated_data)


class HouseSimpleSerializer(serializers.Serializer):
    """Simple serializer for house info in registrations."""

    id = serializers.IntegerField()
    name = serializers.CharField()


class MealRegistrationSerializer(serializers.ModelSerializer):
    """Serializer for MealRegistration model."""

    total_portions = serializers.IntegerField(read_only=True)
    day_of_week = serializers.SerializerMethodField()
    day_name = serializers.SerializerMethodField()
    house = HouseSimpleSerializer(read_only=True)
    is_locked = serializers.SerializerMethodField()
    available_portions = serializers.SerializerMethodField()
    is_from_preference = serializers.SerializerMethodField()

    class Meta:
        model = MealRegistration
        fields = [
            "id",
            "date",
            "day_of_week",
            "day_name",
            "adults_meat",
            "adults_veg",
            "children_count",
            "dining_option",
            "seating_time",
            "house",
            "is_active",
            "total_portions",
            "is_locked",
            "is_from_preference",
            "available_portions",
            "created_at",
            "updated_at",
        ]

    def get_day_of_week(self, obj: MealRegistration) -> int:
        return obj.date.weekday()

    def get_day_name(self, obj: MealRegistration) -> str:
        return DAY_NAMES[obj.date.weekday()]

    def get_is_locked(self, obj: MealRegistration) -> bool:
        return is_after_deadline(obj.date)

    def get_is_from_preference(self, obj: MealRegistration) -> bool:
        return False

    def get_available_portions(self, obj: MealRegistration) -> dict[str, int]:
        """Registration portions minus ALL tickets (listed or claimed) for this date.

        We count both available (listed) and claimed tickets so that a sold
        (claimed) ticket cannot be re-listed. Released tickets are already set
        back to is_available=True and will be counted again, which is intentional.
        """
        existing = FoodTicket.objects.filter(house=obj.house, date=obj.date).aggregate(
            total_meat=Coalesce(Sum("adults_meat"), 0),
            total_veg=Coalesce(Sum("adults_veg"), 0),
            total_children=Coalesce(Sum("children_count"), 0),
        )
        return {
            "adults_meat": max(0, obj.adults_meat - existing["total_meat"]),
            "adults_veg": max(0, obj.adults_veg - existing["total_veg"]),
            "children_count": max(0, obj.children_count - existing["total_children"]),
        }


class MealRegistrationCreateUpdateSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating meal registrations."""

    class Meta:
        model = MealRegistration
        fields = [
            "date",
            "adults_meat",
            "adults_veg",
            "children_count",
            "dining_option",
            "seating_time",
            "is_active",
        ]

    def validate_date(self, value: date) -> date:
        # Only allow Mon-Thu
        if value.weekday() > 3:
            raise serializers.ValidationError("Der serveres kun mad mandag til torsdag.")
        from .utils import is_closed_food_day

        if is_closed_food_day(value):
            raise serializers.ValidationError("Denne dag er lukket for fællesspisning.")
        return value

    def validate(self, attrs: dict) -> dict:
        user = self.context["request"].user
        if not user.house_id:
            raise serializers.ValidationError("Du skal tilhøre et hus for at tilmelde dig.")

        reg_date = attrs.get("date") or (self.instance.date if self.instance else None)
        # For partial updates (PATCH), fall back to instance values so we don't
        # mistakenly flag unchanged fields as violations.
        inst = self.instance
        is_active = attrs.get("is_active", inst.is_active if inst else True)
        adults_meat = attrs.get("adults_meat", inst.adults_meat if inst else 0)
        adults_veg = attrs.get("adults_veg", inst.adults_veg if inst else 0)
        children_count = attrs.get("children_count", inst.children_count if inst else 0)

        if reg_date and is_after_deadline(reg_date):
            if self.instance is None:
                # CREATE after deadline → reject entirely
                raise serializers.ValidationError("Tilmeldingsfristen er overskredet.")
            # UPDATE after deadline → only dining_option and seating_time may change
            locked_fields = {
                "adults_meat": self.instance.adults_meat,
                "adults_veg": self.instance.adults_veg,
                "children_count": self.instance.children_count,
                "is_active": self.instance.is_active,
            }
            for field, current_value in locked_fields.items():
                if field in attrs and attrs[field] != current_value:
                    raise serializers.ValidationError(
                        f"Tilmeldingen er låst — {field} kan ikke ændres efter fristen."
                    )

        if adults_meat > 19:
            raise serializers.ValidationError({"adults_meat": "Maks 19 portioner."})
        if adults_veg > 19:
            raise serializers.ValidationError({"adults_veg": "Maks 19 portioner."})
        if children_count > 19:
            raise serializers.ValidationError({"children_count": "Maks 19 portioner."})

        if reg_date and reg_date.weekday() != 2 and adults_meat > 0:
            raise serializers.ValidationError({"adults_meat": "Kød serveres kun om onsdagen."})

        if is_active and adults_meat + adults_veg + children_count == 0:
            raise serializers.ValidationError("Der skal være mindst én portion.")

        return attrs

    def create(self, validated_data: dict) -> MealRegistration:
        user = self.context["request"].user
        validated_data["house"] = user.house
        validated_data["last_modified_by"] = user
        return super().create(validated_data)

    def update(self, instance: MealRegistration, validated_data: dict) -> MealRegistration:
        validated_data["last_modified_by"] = self.context["request"].user
        return super().update(instance, validated_data)


class FoodTicketSerializer(serializers.ModelSerializer):
    """Serializer for FoodTicket model."""

    owner = AuthorSerializer(read_only=True)
    claimed_by = AuthorSerializer(read_only=True)
    is_free = serializers.BooleanField(read_only=True)
    total_portions = serializers.IntegerField(read_only=True)
    is_own = serializers.SerializerMethodField()
    day_of_week = serializers.SerializerMethodField()
    day_name = serializers.SerializerMethodField()

    class Meta:
        model = FoodTicket
        fields = [
            "id",
            "owner",
            "date",
            "day_of_week",
            "day_name",
            "adults_meat",
            "adults_veg",
            "children_count",
            "price",
            "is_free",
            "description",
            "is_available",
            "claimed_by",
            "claimed_at",
            "total_portions",
            "is_own",
            "created_at",
        ]

    def get_is_own(self, obj: FoodTicket) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.house_id == request.user.house_id
        return False

    def get_day_of_week(self, obj: FoodTicket) -> int:
        return obj.date.weekday()

    def get_day_name(self, obj: FoodTicket) -> str:
        return DAY_NAMES[obj.date.weekday()]


class FoodTicketCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating food tickets."""

    class Meta:
        model = FoodTicket
        fields = ["date", "adults_meat", "adults_veg", "children_count", "price", "description"]

    def validate_date(self, value: date) -> date:
        # Only allow Mon-Thu
        if value.weekday() > 3:
            raise serializers.ValidationError("Der serveres kun mad mandag til torsdag.")
        from .utils import is_closed_food_day

        if is_closed_food_day(value):
            raise serializers.ValidationError("Denne dag er lukket for fællesspisning.")
        # Don't allow past dates
        if value < timezone.now().date():
            raise serializers.ValidationError("Der kan ikke oprettes billet til datoer i fortiden.")

        # Don't allow selling tickets after the cutoff time on the meal day
        now = timezone.now()
        if value == now.date() and now.time() >= TICKET_SALE_CUTOFF_TIME:
            raise serializers.ValidationError(
                "Salg af billetter er lukket efter kl. 18:30 på maddagen."
            )

        # Tickets can only be created after the registration deadline
        deadline = get_registration_deadline(value)
        if timezone.now() < deadline:
            deadline_str = deadline.strftime("%A, %d/%m kl. %H:%M")
            raise serializers.ValidationError(
                f"Billetter kan først oprettes efter tilmeldingsfristen ({deadline_str})."
            )

        return value

    def calculate_default_price(
        self, adults_meat: int, adults_veg: int, children_count: int, meal_date: date
    ) -> Decimal:
        """Calculate default price from portion counts, at the meal date's prices."""
        from .pricing import calculate_meal_price

        return calculate_meal_price(adults_meat, adults_veg, children_count, meal_date)

    def validate(self, attrs: dict) -> dict:
        reg_date = attrs.get("date")
        adults_meat = attrs.get("adults_meat", 0)
        adults_veg = attrs.get("adults_veg", 0)
        children_count = attrs.get("children_count", 0)

        if reg_date and reg_date.weekday() != 2 and adults_meat > 0:
            raise serializers.ValidationError({"adults_meat": "Kød serveres kun om onsdagen."})

        if adults_meat + adults_veg + children_count == 0:
            raise serializers.ValidationError("Der skal være mindst én portion.")

        # Validate portions don't exceed registration minus existing available tickets
        if reg_date:
            user = self.context["request"].user
            if not user.house_id:
                raise serializers.ValidationError("Du skal tilhøre et hus for at sælge en billet.")
            reg = MealRegistration.objects.filter(
                house=user.house, date=reg_date, is_active=True
            ).first()
            if not reg:
                raise serializers.ValidationError(
                    "Dit hus skal have en aktiv tilmelding for at sælge en billet."
                )
            # Sum of ALL tickets for this date (listed + claimed) to prevent re-listing
            # portions that are already sold. Released tickets are back to is_available=True
            # and will be counted again, which is intentional.
            existing = FoodTicket.objects.filter(house=user.house, date=reg_date).aggregate(
                total_meat=Coalesce(Sum("adults_meat"), 0),
                total_veg=Coalesce(Sum("adults_veg"), 0),
                total_children=Coalesce(Sum("children_count"), 0),
            )
            available_meat = reg.adults_meat - existing["total_meat"]
            available_veg = reg.adults_veg - existing["total_veg"]
            available_children = reg.children_count - existing["total_children"]

            if adults_meat > available_meat:
                raise serializers.ValidationError(
                    {
                        "adults_meat": "Du kan ikke sælge flere kød-portioner end du har tilgængelige."
                    }
                )
            if adults_veg > available_veg:
                raise serializers.ValidationError(
                    {
                        "adults_veg": "Du kan ikke sælge flere vegetar-portioner end du har tilgængelige."
                    }
                )
            if children_count > available_children:
                raise serializers.ValidationError(
                    {
                        "children_count": "Du kan ikke sælge flere børne-portioner end du har tilgængelige."
                    }
                )

        return attrs

    def create(self, validated_data: dict) -> FoodTicket:
        user = self.context["request"].user
        validated_data["owner"] = user
        validated_data["house"] = user.house

        ticket_adults_meat = validated_data.get("adults_meat", 0)
        ticket_adults_veg = validated_data.get("adults_veg", 0)
        ticket_children = validated_data.get("children_count", 0)

        # Set default price if not provided
        if validated_data.get("price") is None:
            validated_data["price"] = self.calculate_default_price(
                ticket_adults_meat,
                ticket_adults_veg,
                ticket_children,
                validated_data["date"],
            )

        return super().create(validated_data)


# Food Team Serializers


class TeamMemberUserSerializer(AvatarUrlMixin, serializers.ModelSerializer):
    """Minimal user info for team member display."""

    class Meta:
        model = User
        fields = ["id", "first_name", "last_name", "profile_picture"]


class FoodTeamMemberSerializer(serializers.ModelSerializer):
    """Serializer for FoodTeamMember model."""

    user = TeamMemberUserSerializer(read_only=True)
    is_own = serializers.SerializerMethodField()

    class Meta:
        model = FoodTeamMember
        fields = ["id", "user", "house_number", "is_own", "created_at"]

    def get_is_own(self, obj: FoodTeamMember) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.user_id == request.user.id
        return False


class FoodTeamSerializer(serializers.ModelSerializer):
    """Serializer for FoodTeam model with members."""

    members = FoodTeamMemberSerializer(many=True, read_only=True)
    day_name = serializers.CharField(read_only=True)
    member_count = serializers.IntegerField(read_only=True)
    is_my_team = serializers.SerializerMethodField()

    class Meta:
        model = FoodTeam
        fields = [
            "id",
            "date",
            "day_name",
            "notes",
            "members",
            "member_count",
            "is_my_team",
            "created_at",
            "updated_at",
        ]

    def get_is_my_team(self, obj: FoodTeam) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.members.filter(user_id=request.user.id).exists()
        return False


class FoodTeamListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for listing teams."""

    day_name = serializers.CharField(read_only=True)
    member_count = serializers.IntegerField(read_only=True)
    is_my_team = serializers.SerializerMethodField()
    members_display = serializers.SerializerMethodField()

    class Meta:
        model = FoodTeam
        fields = [
            "id",
            "date",
            "day_name",
            "member_count",
            "is_my_team",
            "members_display",
        ]

    def get_is_my_team(self, obj: FoodTeam) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.members.filter(user_id=request.user.id).exists()
        return False

    def get_members_display(self, obj: FoodTeam) -> str:
        """Get a comma-separated list of members for display."""
        members = obj.members.select_related("user")[:6]
        return ", ".join(
            f"{m.user.first_name} ({m.house_number})" if m.house_number else m.user.first_name
            for m in members
        )


class SwapRequestUserSerializer(AvatarUrlMixin, serializers.ModelSerializer):
    """User info for swap requests."""

    class Meta:
        model = User
        fields = ["id", "first_name", "last_name", "profile_picture"]


class SwapRequestMembershipSerializer(serializers.ModelSerializer):
    """Membership info for swap requests."""

    user = SwapRequestUserSerializer(read_only=True)
    team_date = serializers.DateField(source="team.date", read_only=True)
    team_day_name = serializers.CharField(source="team.day_name", read_only=True)

    class Meta:
        model = FoodTeamMember
        fields = ["id", "user", "house_number", "team_date", "team_day_name"]


class TeamSwapRequestSerializer(serializers.ModelSerializer):
    """Serializer for TeamSwapRequest model."""

    requester = SwapRequestUserSerializer(read_only=True)
    requester_membership = SwapRequestMembershipSerializer(read_only=True)
    target_membership = SwapRequestMembershipSerializer(read_only=True)
    is_incoming = serializers.SerializerMethodField()
    is_outgoing = serializers.SerializerMethodField()

    class Meta:
        model = TeamSwapRequest
        fields = [
            "id",
            "requester",
            "requester_membership",
            "target_membership",
            "status",
            "message",
            "response_message",
            "is_incoming",
            "is_outgoing",
            "created_at",
            "updated_at",
        ]

    def get_is_incoming(self, obj: TeamSwapRequest) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.target_membership.user_id == request.user.id
        return False

    def get_is_outgoing(self, obj: TeamSwapRequest) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.requester_id == request.user.id
        return False


class CreateSwapRequestSerializer(serializers.Serializer):
    """Serializer for creating a swap request."""

    requester_membership_id = serializers.IntegerField()
    target_membership_id = serializers.IntegerField()
    message = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_requester_membership_id(self, value: int) -> int:
        request = self.context.get("request")
        try:
            membership = FoodTeamMember.objects.get(id=value)
        except FoodTeamMember.DoesNotExist as e:
            raise serializers.ValidationError("Medlemskabet findes ikke.") from e

        if membership.user_id != request.user.id:
            raise serializers.ValidationError("Du kan kun bytte dine egne holdmedlemskaber.")

        return value

    def validate_target_membership_id(self, value: int) -> int:
        try:
            membership = FoodTeamMember.objects.get(id=value)
        except FoodTeamMember.DoesNotExist as e:
            raise serializers.ValidationError("Det valgte medlemskab findes ikke.") from e

        request = self.context.get("request")
        if membership.user_id == request.user.id:
            raise serializers.ValidationError("Du kan ikke bytte med dig selv.")

        return value

    def validate(self, attrs: dict) -> dict:
        # Check for existing pending request
        existing = TeamSwapRequest.objects.filter(
            requester_membership_id=attrs["requester_membership_id"],
            target_membership_id=attrs["target_membership_id"],
            status=SwapRequestStatus.PENDING,
        ).exists()

        if existing:
            raise serializers.ValidationError(
                "You already have a pending swap request for this combination."
            )

        # Don't let someone create a request that could never be accepted (it
        # would double-book one of them on a team). The accept path re-checks,
        # since memberships move via takeovers in the meantime.
        from .utils import membership_swap_conflict

        memberships = FoodTeamMember.objects.select_related("team").in_bulk(
            [attrs["requester_membership_id"], attrs["target_membership_id"]]
        )
        conflict = membership_swap_conflict(
            memberships[attrs["requester_membership_id"]],
            memberships[attrs["target_membership_id"]],
        )
        if conflict:
            raise serializers.ValidationError(conflict)

        return attrs

    def create(self, validated_data: dict) -> TeamSwapRequest:
        request = self.context.get("request")
        return TeamSwapRequest.objects.create(
            requester=request.user,
            requester_membership_id=validated_data["requester_membership_id"],
            target_membership_id=validated_data["target_membership_id"],
            message=validated_data.get("message", ""),
        )


class RespondSwapRequestSerializer(serializers.Serializer):
    """Serializer for responding to a swap request."""

    action = serializers.ChoiceField(choices=["accept", "decline"])
    response_message = serializers.CharField(required=False, allow_blank=True, default="")


# Food Team Cycle Serializers


class FoodTeamCycleSerializer(serializers.ModelSerializer):
    """Serializer for FoodTeamCycle model."""

    is_accepting_wishes = serializers.BooleanField(read_only=True)
    team_count = serializers.SerializerMethodField()
    wish_count = serializers.SerializerMethodField()
    my_wish_submitted = serializers.SerializerMethodField()

    class Meta:
        model = FoodTeamCycle
        fields = [
            "id",
            "name",
            "cooking_dates",
            "wish_deadline",
            "status",
            "is_accepting_wishes",
            "team_count",
            "wish_count",
            "my_wish_submitted",
            "created_at",
            "updated_at",
        ]

    def get_team_count(self, obj: FoodTeamCycle) -> int:
        return obj.teams.count()

    def get_wish_count(self, obj: FoodTeamCycle) -> int:
        return obj.wishes.count()

    def get_my_wish_submitted(self, obj: FoodTeamCycle) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.wishes.filter(user=request.user).exists()
        return False


class FoodTeamCycleCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating a FoodTeamCycle."""

    cooking_dates = serializers.ListField(
        child=serializers.DateField(),
        min_length=1,
        help_text="List of cooking dates",
    )

    class Meta:
        model = FoodTeamCycle
        fields = ["name", "cooking_dates", "wish_deadline"]

    def validate_cooking_dates(self, value: list) -> list:
        from .utils import get_closed_food_dates

        closed = get_closed_food_dates(value)
        if closed:
            closed_strs = ", ".join(sorted(d.isoformat() for d in closed))
            raise serializers.ValidationError(f"Følgende datoer er lukkede maddage: {closed_strs}")
        # Sort dates and convert to ISO format strings
        sorted_dates = sorted(value)
        return [d.isoformat() for d in sorted_dates]

    def create(self, validated_data: dict) -> FoodTeamCycle:
        validated_data["created_by"] = self.context["request"].user
        return super().create(validated_data)


class FoodTeamWishSerializer(serializers.ModelSerializer):
    """Serializer for FoodTeamWish model."""

    user_name = serializers.SerializerMethodField()
    available_date_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = FoodTeamWish
        fields = [
            "id",
            "cycle",
            "user",
            "user_name",
            "available_dates",
            "available_date_count",
            "is_unavailable",
            "comment",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["user"]

    def get_user_name(self, obj: FoodTeamWish) -> str:
        return f"{obj.user.first_name} {obj.user.last_name}"


class FoodTeamWishCreateUpdateSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating food team wishes."""

    class Meta:
        model = FoodTeamWish
        fields = ["cycle", "available_dates", "is_unavailable", "comment"]

    def validate_cycle(self, value: FoodTeamCycle) -> FoodTeamCycle:
        if not value.is_accepting_wishes:
            raise serializers.ValidationError("Perioden tager ikke længere imod ønsker.")
        return value

    def validate_available_dates(self, value: list) -> list:
        # Ensure dates are valid strings
        validated = []
        for d in value:
            if isinstance(d, str):
                try:
                    date.fromisoformat(d)
                    validated.append(d)
                except ValueError as e:
                    raise serializers.ValidationError(f"Ugyldigt datoformat: {d}") from e
            elif isinstance(d, date):
                validated.append(d.isoformat())

        # Filter out any closed food days
        from .utils import get_closed_food_dates

        date_map = {d: date.fromisoformat(d) for d in validated}
        closed = get_closed_food_dates(list(date_map.values()))
        if closed:
            validated = [d for d, parsed in date_map.items() if parsed not in closed]

        return validated

    def create(self, validated_data: dict) -> FoodTeamWish:
        validated_data["user"] = self.context["request"].user

        # Check if user already has a wish for this cycle
        existing = FoodTeamWish.objects.filter(
            cycle=validated_data["cycle"],
            user=validated_data["user"],
        ).first()

        if existing:
            # Update existing wish
            for key, value in validated_data.items():
                if key != "user":
                    setattr(existing, key, value)
            existing.save()
            return existing

        return super().create(validated_data)


class GenerateTeamsSerializer(serializers.Serializer):
    """Serializer for triggering team generation."""

    cycle_id = serializers.IntegerField()
    dry_run = serializers.BooleanField(default=False)

    def validate_cycle_id(self, value: int) -> int:
        try:
            cycle = FoodTeamCycle.objects.get(id=value)
        except FoodTeamCycle.DoesNotExist as e:
            raise serializers.ValidationError("Perioden blev ikke fundet.") from e

        if cycle.status == CycleStatus.FINALIZED:
            raise serializers.ValidationError(
                "This cycle has already been finalized. Delete existing teams first to regenerate."
            )

        return value


class TeamGenerationResultSerializer(serializers.Serializer):
    """Serializer for team generation results."""

    success = serializers.BooleanField()
    message = serializers.CharField()
    teams_created = serializers.IntegerField()
    unassigned_persons = serializers.ListField(child=serializers.CharField())
    warnings = serializers.ListField(child=serializers.CharField())
    dropped_dates = serializers.ListField(child=serializers.CharField())


class DefaultCookingDaysSerializer(serializers.Serializer):
    """Serializer for user's default cooking days preference."""

    default_cooking_days = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=3),
        allow_empty=True,
        help_text="List of weekday integers (0=Monday, 1=Tuesday, 2=Wednesday, 3=Thursday)",
    )

    def validate_default_cooking_days(self, value: list) -> list:
        # Remove duplicates and sort
        return sorted(set(value))


class MonthlyFoodCostSerializer(serializers.Serializer):
    """Serializer for monthly food cost query."""

    year = serializers.IntegerField(min_value=2020, max_value=2100)
    month = serializers.IntegerField(min_value=1, max_value=12)


class HouseFoodCostSerializer(serializers.Serializer):
    """Serializer for per-house food cost result."""

    house_id = serializers.IntegerField()
    house_name = serializers.CharField()
    total_cost = serializers.DecimalField(max_digits=10, decimal_places=2)
    registration_count = serializers.IntegerField()
    adult_meat_portions = serializers.IntegerField()
    adult_veg_portions = serializers.IntegerField()
    child_portions = serializers.IntegerField()


class MonthlyFoodCostReportSerializer(serializers.Serializer):
    """Serializer for food cost report result over a date range."""

    start_date = serializers.CharField()
    end_date = serializers.CharField()
    total_cost = serializers.DecimalField(max_digits=10, decimal_places=2)
    houses = HouseFoodCostSerializer(many=True)


class DriveMenuCacheSerializer(serializers.ModelSerializer):
    """Serializer for DriveMenuCache model."""

    is_stale = serializers.SerializerMethodField()
    week_start_date = serializers.SerializerMethodField()
    drive_folder_url = serializers.SerializerMethodField()

    class Meta:
        model = DriveMenuCache
        fields = [
            "id",
            "week_number",
            "year",
            "week_start_date",
            "monday_menu",
            "tuesday_menu",
            "wednesday_menu",
            "thursday_menu",
            "fetched_at",
            "is_stale",
            "drive_folder_url",
        ]

    def get_is_stale(self, obj: DriveMenuCache) -> bool:
        from django.conf import settings

        return obj.is_stale(settings.MENU_CACHE_HOURS)

    def get_drive_folder_url(self, obj: DriveMenuCache) -> str:
        from django.conf import settings

        folder_id = obj.drive_folder_id or settings.GOOGLE_DRIVE_MENU_FOLDER_ID
        return f"https://drive.google.com/drive/folders/{folder_id}"

    def get_week_start_date(self, obj: DriveMenuCache) -> str:
        """Calculate the Monday of this week."""
        from datetime import date as dt_date

        # Calculate the Monday of week 1
        # ISO week 1 is the week containing the 4th of January
        jan4 = dt_date(obj.year, 1, 4)
        week1_monday = jan4 - timedelta(days=jan4.weekday())
        # Calculate the Monday of the target week
        target_monday = week1_monday + timedelta(weeks=obj.week_number - 1)
        return target_monday.isoformat()


class ClosedFoodDaySerializer(serializers.ModelSerializer):
    day_name = serializers.SerializerMethodField()

    class Meta:
        model = ClosedFoodDay
        fields = ["id", "date", "day_name", "reason", "created_at"]

    def get_day_name(self, obj: ClosedFoodDay) -> str:
        return DAY_NAMES[obj.date.weekday()]


class ClosedFoodDayCreateSerializer(serializers.Serializer):
    dates = serializers.ListField(child=serializers.DateField(), min_length=1)
    reason = serializers.CharField(max_length=200, required=False, default="")

    def validate_dates(self, value: list[date]) -> list[date]:
        for d in value:
            if d.weekday() > 3:
                raise serializers.ValidationError(
                    f"{d.isoformat()} er ikke en maddag (kun mandag-torsdag)."
                )
        return sorted(value)

    def create(self, validated_data: dict) -> list[ClosedFoodDay]:
        user = self.context["request"].user
        reason = validated_data["reason"]
        results = []
        for d in validated_data["dates"]:
            obj, _created = ClosedFoodDay.objects.get_or_create(
                date=d,
                defaults={"reason": reason, "created_by": user},
            )
            results.append(obj)
        return results


# --------------------------------------------------------------------------- #
# Madhold launch: takeover (favours), broadcast swaps, personal profile       #
# --------------------------------------------------------------------------- #


class TeamFavourSerializer(serializers.ModelSerializer):
    """A 'you owe me one' favour created by a shift takeover."""

    creditor = SwapRequestUserSerializer(read_only=True)
    debtor = SwapRequestUserSerializer(read_only=True)
    direction = serializers.SerializerMethodField()

    class Meta:
        model = TeamFavour
        fields = [
            "id",
            "creditor",
            "debtor",
            "origin_date",
            "settled",
            "settled_at",
            "note",
            "direction",
            "created_at",
        ]

    def get_direction(self, obj: TeamFavour) -> str:
        """'owed_to_me' if the current user is the creditor, else 'i_owe'."""
        request = self.context.get("request")
        if request and request.user.is_authenticated and obj.creditor_id == request.user.id:
            return "owed_to_me"
        return "i_owe"


class TakeoverSerializer(serializers.Serializer):
    """Take over another user's cooking shift (they owe you one)."""

    target_membership_id = serializers.IntegerField()
    note = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_target_membership_id(self, value: int) -> int:
        try:
            membership = FoodTeamMember.objects.select_related("team", "user").get(pk=value)
        except FoodTeamMember.DoesNotExist as e:
            raise serializers.ValidationError("Madholdsmedlemskab ikke fundet.") from e

        user = self.context["request"].user
        if membership.user_id == user.id:
            raise serializers.ValidationError("Du kan ikke overtage din egen maddag.")
        if membership.team.date < timezone.localdate():
            raise serializers.ValidationError("Maddagen er allerede passeret.")
        # Can't take over a date you're already cooking on.
        if FoodTeamMember.objects.filter(team=membership.team, user=user).exists():
            raise serializers.ValidationError("Du er allerede på dette madhold.")
        self.context["target_membership"] = membership
        return value


class SwapBroadcastMembershipSerializer(serializers.ModelSerializer):
    """Membership info embedded in a broadcast."""

    user = SwapRequestUserSerializer(read_only=True)
    date = serializers.DateField(source="team.date", read_only=True)
    day_name = serializers.CharField(source="team.day_name", read_only=True)

    class Meta:
        model = FoodTeamMember
        fields = ["id", "user", "house_number", "date", "day_name"]


class SwapBroadcastSerializer(serializers.ModelSerializer):
    """Read serializer for a broadcast 'bytteanmodning'."""

    requester = SwapRequestUserSerializer(read_only=True)
    requester_membership = SwapBroadcastMembershipSerializer(read_only=True)
    accepted_by = SwapRequestUserSerializer(read_only=True)
    is_mine = serializers.SerializerMethodField()
    can_accept = serializers.SerializerMethodField()

    class Meta:
        model = SwapBroadcast
        fields = [
            "id",
            "requester",
            "requester_membership",
            "available_dates",
            "message",
            "status",
            "accepted_by",
            "is_mine",
            "can_accept",
            "created_at",
            "updated_at",
        ]

    def get_is_mine(self, obj: SwapBroadcast) -> bool:
        request = self.context.get("request")
        return bool(request and obj.requester_id == request.user.id)

    def get_can_accept(self, obj: SwapBroadcast) -> bool:
        """True if the current user holds a membership on one of the offered dates."""
        request = self.context.get("request")
        if not request or obj.status != BroadcastStatus.OPEN or obj.requester_id == request.user.id:
            return False
        dates = [date.fromisoformat(d) for d in obj.available_dates]
        return FoodTeamMember.objects.filter(user=request.user, team__date__in=dates).exists()


class CreateSwapBroadcastSerializer(serializers.Serializer):
    """Create a broadcast: get rid of one date, offer to take any of several."""

    requester_membership_id = serializers.IntegerField()
    available_dates = serializers.ListField(child=serializers.DateField(), min_length=1)
    message = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_requester_membership_id(self, value: int) -> int:
        try:
            membership = FoodTeamMember.objects.select_related("team").get(pk=value)
        except FoodTeamMember.DoesNotExist as e:
            raise serializers.ValidationError("Madholdsmedlemskab ikke fundet.") from e
        if membership.user_id != self.context["request"].user.id:
            raise serializers.ValidationError("Det er ikke din maddag.")
        if membership.team.date < timezone.localdate():
            raise serializers.ValidationError("Maddagen er allerede passeret.")
        self.context["requester_membership"] = membership
        return value

    def validate(self, attrs: dict) -> dict:
        membership = self.context["requester_membership"]
        own_date = membership.team.date
        if own_date in attrs["available_dates"]:
            raise serializers.ValidationError(
                {"available_dates": "Din egen maddag kan ikke være blandt de ønskede dage."}
            )
        return attrs


class AcceptSwapBroadcastSerializer(serializers.Serializer):
    """Accept a broadcast with one of your own memberships on an offered date."""

    membership_id = serializers.IntegerField()


class MyFoodProfileSerializer(serializers.ModelSerializer):
    """Self-service food-team profile settings for the current user."""

    housemate_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "can_be_head_chef",
            "prefers_cooking_with_housemate",
            "is_over_50",
            "is_exempt_from_food_teams",
            "default_cooking_days",
            "food_team_comment",
            "housemate_name",
        ]

    def get_housemate_name(self, obj: User) -> str:
        """First housemate (same house, other user) — for the cook-together toggle."""
        if not obj.house_id:
            return ""
        mate = (
            User.objects.filter(house_id=obj.house_id)
            .exclude(pk=obj.pk)
            .order_by("first_name")
            .first()
        )
        return mate.first_name if mate else ""

    def validate_default_cooking_days(self, value: list) -> list:
        return sorted({v for v in value if 0 <= v <= 3})


class FoodRosterSerializer(serializers.ModelSerializer):
    """Admin roster row for configuring food-team flags across users."""

    house_name = serializers.CharField(source="house.name", read_only=True, default="")

    class Meta:
        model = User
        fields = [
            "id",
            "first_name",
            "last_name",
            "house_name",
            "can_be_head_chef",
            "prefers_cooking_with_housemate",
            "is_over_50",
            "is_exempt_from_food_teams",
            "is_food_admin",
        ]
        read_only_fields = ["id", "first_name", "last_name", "house_name"]


# Meal Price Serializers


def _price_field(**kwargs: Any) -> serializers.DecimalField:
    """A price in whole-krone range, serialized as a number so the UI can do math."""
    return serializers.DecimalField(
        max_digits=6,
        decimal_places=2,
        min_value=Decimal("0.00"),
        max_value=Decimal("9999.99"),
        coerce_to_string=False,
        **kwargs,
    )


class MealPriceSerializer(serializers.ModelSerializer):
    """A price set. Read-only for everyone but food admins (enforced in the view)."""

    # Declared explicitly to drop the auto-generated UniqueValidator and its
    # English message — `validate_effective_from` reports the clash in Danish.
    effective_from = serializers.DateField()
    price_adult_meat = _price_field()
    price_adult_veg = _price_field()
    price_child = _price_field()
    created_by_name = serializers.SerializerMethodField()
    is_locked = serializers.SerializerMethodField()

    class Meta:
        model = MealPrice
        fields = [
            "id",
            "effective_from",
            "price_adult_meat",
            "price_adult_veg",
            "price_child",
            "note",
            "created_by_name",
            "created_at",
            "is_locked",
        ]
        read_only_fields = ["id", "created_by_name", "created_at", "is_locked"]

    def get_created_by_name(self, obj: MealPrice) -> str:
        return obj.created_by.get_full_name() if obj.created_by else ""

    def get_is_locked(self, obj: MealPrice) -> bool:
        """True once the price set has taken effect — it can no longer be changed."""
        return obj.effective_from < timezone.localdate()

    def validate_effective_from(self, value: date) -> date:
        # Prices are resolved by meal date, so backdating a price set would
        # silently rewrite past cost reports and economy pages.
        if value < timezone.localdate():
            raise serializers.ValidationError(
                "Startdatoen kan ikke være i fortiden — det ville ændre allerede "
                "afregnede madomkostninger."
            )
        existing = MealPrice.objects.filter(effective_from=value)
        if self.instance is not None:
            existing = existing.exclude(pk=self.instance.pk)
        if existing.exists():
            raise serializers.ValidationError("Der findes allerede et prissæt med denne startdato.")
        return value

    def validate(self, attrs: dict) -> dict:
        # Editing a price set that is already in effect would change history too.
        if self.instance is not None and self.instance.effective_from < timezone.localdate():
            raise serializers.ValidationError(
                "Prissættet er allerede trådt i kraft og kan ikke ændres. "
                "Opret i stedet et nyt prissæt med en fremtidig startdato."
            )
        return attrs

    def create(self, validated_data: dict) -> MealPrice:
        validated_data["created_by"] = self.context["request"].user
        return super().create(validated_data)
