"""
Serializers for Food models.
"""

from datetime import date, timedelta

from django.utils import timezone
from rest_framework import serializers

from apps.users.models import User

from .models import (
    CycleStatus,
    DailyMenu,
    DayOfWeek,
    FoodTeam,
    FoodTeamCycle,
    FoodTeamMember,
    FoodTeamWish,
    FoodTicket,
    MealPreference,
    MealRegistration,
    MenuTemplate,
    SwapRequestStatus,
    TeamSwapRequest,
    WeeklyMenu,
)


class AuthorSerializer(serializers.ModelSerializer):
    """Minimal serializer for user info."""

    class Meta:
        model = User
        fields = ["id", "first_name", "last_name", "profile_picture", "phone_number"]


class MenuTemplateSerializer(serializers.ModelSerializer):
    """Serializer for MenuTemplate model."""

    class Meta:
        model = MenuTemplate
        fields = [
            "id",
            "name",
            "description",
            "has_meat_option",
            "meat_description",
            "vegetarian_description",
            "created_at",
            "updated_at",
        ]


class MenuTemplateSimpleSerializer(serializers.ModelSerializer):
    """Simple serializer for embedding in DailyMenu."""

    class Meta:
        model = MenuTemplate
        fields = ["id", "name"]


class DailyMenuSerializer(serializers.ModelSerializer):
    """Serializer for DailyMenu model."""

    day_name = serializers.CharField(source="get_day_of_week_display", read_only=True)
    template = MenuTemplateSimpleSerializer(read_only=True)
    menu_name = serializers.CharField(read_only=True)
    effective_description = serializers.CharField(read_only=True)
    effective_meat_description = serializers.CharField(read_only=True)
    effective_vegetarian_description = serializers.CharField(read_only=True)

    class Meta:
        model = DailyMenu
        fields = [
            "id",
            "date",
            "day_of_week",
            "day_name",
            "template",
            "menu_name",
            "description",
            "effective_description",
            "has_meat_option",
            "meat_description",
            "effective_meat_description",
            "vegetarian_description",
            "effective_vegetarian_description",
        ]


class WeeklyMenuSerializer(serializers.ModelSerializer):
    """Serializer for WeeklyMenu with daily menus."""

    daily_menus = DailyMenuSerializer(many=True, read_only=True)
    created_by = AuthorSerializer(read_only=True)

    class Meta:
        model = WeeklyMenu
        fields = [
            "id",
            "week_start_date",
            "daily_menus",
            "created_by",
            "created_at",
            "updated_at",
        ]


class WeeklyMenuCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating a weekly menu."""

    class Meta:
        model = WeeklyMenu
        fields = ["week_start_date"]

    def validate_week_start_date(self, value: date) -> date:
        # Ensure it's a Monday
        if value.weekday() != 0:
            raise serializers.ValidationError("Week start date must be a Monday.")
        return value

    def create(self, validated_data: dict) -> WeeklyMenu:
        validated_data["created_by"] = self.context["request"].user
        weekly_menu = super().create(validated_data)

        # Create daily menus for Mon-Thu
        for day in range(4):  # 0=Mon, 1=Tue, 2=Wed, 3=Thu
            menu_date = weekly_menu.week_start_date + timedelta(days=day)
            DailyMenu.objects.create(
                weekly_menu=weekly_menu,
                date=menu_date,
                day_of_week=day,
                has_meat_option=(day == DayOfWeek.WEDNESDAY),  # Wed has meat option
            )

        return weekly_menu


class DailyMenuUpdateSerializer(serializers.ModelSerializer):
    """Serializer for updating a daily menu."""

    template_id = serializers.IntegerField(required=False, allow_null=True)

    class Meta:
        model = DailyMenu
        fields = [
            "template_id",
            "description",
            "has_meat_option",
            "meat_description",
            "vegetarian_description",
        ]

    def validate_template_id(self, value: int | None) -> int | None:
        if value is not None and not MenuTemplate.objects.filter(id=value).exists():
            raise serializers.ValidationError("Menu template does not exist.")
        return value

    def update(self, instance: DailyMenu, validated_data: dict) -> DailyMenu:
        template_id = validated_data.pop("template_id", None)
        if template_id is not None:
            instance.template = MenuTemplate.objects.get(id=template_id) if template_id else None
        elif "template_id" in self.initial_data and self.initial_data["template_id"] is None:
            instance.template = None
        return super().update(instance, validated_data)


class MealPreferenceSerializer(serializers.ModelSerializer):
    """Serializer for MealPreference model."""

    day_name = serializers.CharField(source="get_day_of_week_display", read_only=True)

    class Meta:
        model = MealPreference
        fields = [
            "id",
            "day_of_week",
            "day_name",
            "adults_count",
            "children_count",
            "prefers_meat",
            "dining_option",
            "seating_time",
        ]


class MealPreferenceCreateUpdateSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating meal preferences."""

    class Meta:
        model = MealPreference
        fields = [
            "day_of_week",
            "adults_count",
            "children_count",
            "prefers_meat",
            "dining_option",
            "seating_time",
        ]

    def create(self, validated_data: dict) -> MealPreference:
        validated_data["user"] = self.context["request"].user
        return super().create(validated_data)


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

    class Meta:
        model = MealRegistration
        fields = [
            "id",
            "date",
            "day_of_week",
            "day_name",
            "adults_count",
            "children_count",
            "meal_type",
            "dining_option",
            "seating_time",
            "house",
            "is_active",
            "total_portions",
            "created_at",
            "updated_at",
        ]

    def get_day_of_week(self, obj: MealRegistration) -> int:
        return obj.date.weekday()

    def get_day_name(self, obj: MealRegistration) -> str:
        days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        return days[obj.date.weekday()]


class MealRegistrationCreateUpdateSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating meal registrations."""

    house_id = serializers.IntegerField(required=False, allow_null=True)

    class Meta:
        model = MealRegistration
        fields = [
            "date",
            "adults_count",
            "children_count",
            "meal_type",
            "dining_option",
            "seating_time",
            "house_id",
            "is_active",
        ]

    def validate_date(self, value: date) -> date:
        # Only allow Mon-Thu
        if value.weekday() > 3:
            raise serializers.ValidationError("Meals are only served Monday through Thursday.")
        return value

    def validate_house_id(self, value: int | None) -> int | None:
        if value is not None:
            from apps.houses.models import House

            if not House.objects.filter(id=value).exists():
                raise serializers.ValidationError("House does not exist.")
            # Check if user belongs to this house
            user = self.context["request"].user
            if user.house_id != value:
                raise serializers.ValidationError(
                    "You can only register on behalf of your own house."
                )
        return value

    def create(self, validated_data: dict) -> MealRegistration:
        house_id = validated_data.pop("house_id", None)
        validated_data["user"] = self.context["request"].user
        if house_id:
            from apps.houses.models import House

            validated_data["house"] = House.objects.get(id=house_id)
        return super().create(validated_data)

    def update(self, instance: MealRegistration, validated_data: dict) -> MealRegistration:
        house_id = validated_data.pop("house_id", None)
        if house_id is not None:
            from apps.houses.models import House

            validated_data["house"] = House.objects.get(id=house_id) if house_id else None
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
            "adults_count",
            "children_count",
            "meal_type",
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
            return obj.owner_id == request.user.id
        return False

    def get_day_of_week(self, obj: FoodTicket) -> int:
        return obj.date.weekday()

    def get_day_name(self, obj: FoodTicket) -> str:
        days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        return days[obj.date.weekday()]


class FoodTicketCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating food tickets."""

    class Meta:
        model = FoodTicket
        fields = ["date", "adults_count", "children_count", "meal_type", "price", "description"]

    def validate_date(self, value: date) -> date:
        # Only allow Mon-Thu
        if value.weekday() > 3:
            raise serializers.ValidationError("Meals are only served Monday through Thursday.")
        # Don't allow past dates
        if value < timezone.now().date():
            raise serializers.ValidationError("Cannot create ticket for past dates.")
        return value

    def create(self, validated_data: dict) -> FoodTicket:
        from apps.notifications.services import notify_food_ticket_available

        validated_data["owner"] = self.context["request"].user
        ticket = super().create(validated_data)

        # Notify all users about the new ticket
        notify_food_ticket_available(
            recipients=User.objects.all(),
            owner=ticket.owner,
            ticket_date=ticket.date.strftime("%A, %b %d"),
            ticket_id=ticket.id,
            portions=ticket.total_portions,
        )

        return ticket


class ApplyDefaultsSerializer(serializers.Serializer):
    """Serializer for applying default preferences to a week."""

    week_start_date = serializers.DateField()

    def validate_week_start_date(self, value: date) -> date:
        if value.weekday() != 0:
            raise serializers.ValidationError("Week start date must be a Monday.")
        return value


# Food Team Serializers


class TeamMemberUserSerializer(serializers.ModelSerializer):
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


class SwapRequestUserSerializer(serializers.ModelSerializer):
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
            raise serializers.ValidationError("Membership does not exist.") from e

        if membership.user_id != request.user.id:
            raise serializers.ValidationError("You can only swap your own team memberships.")

        return value

    def validate_target_membership_id(self, value: int) -> int:
        try:
            membership = FoodTeamMember.objects.get(id=value)
        except FoodTeamMember.DoesNotExist as e:
            raise serializers.ValidationError("Target membership does not exist.") from e

        request = self.context.get("request")
        if membership.user_id == request.user.id:
            raise serializers.ValidationError("You cannot swap with yourself.")

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

    cooking_dates = serializers.ListField(child=serializers.DateField(), read_only=True)
    is_accepting_wishes = serializers.BooleanField(read_only=True)
    team_count = serializers.SerializerMethodField()
    wish_count = serializers.SerializerMethodField()
    my_wish_submitted = serializers.SerializerMethodField()

    class Meta:
        model = FoodTeamCycle
        fields = [
            "id",
            "name",
            "start_date",
            "end_date",
            "wish_deadline",
            "status",
            "cooking_dates",
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

    class Meta:
        model = FoodTeamCycle
        fields = ["name", "start_date", "end_date", "wish_deadline"]

    def validate_start_date(self, value: date) -> date:
        if value.weekday() != 0:
            raise serializers.ValidationError("Start date must be a Monday.")
        return value

    def validate_end_date(self, value: date) -> date:
        if value.weekday() != 3:
            raise serializers.ValidationError("End date must be a Thursday.")
        return value

    def validate(self, attrs: dict) -> dict:
        if attrs["end_date"] <= attrs["start_date"]:
            raise serializers.ValidationError("End date must be after start date.")
        return attrs

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
        fields = ["cycle", "available_dates", "comment"]

    def validate_cycle(self, value: FoodTeamCycle) -> FoodTeamCycle:
        if not value.is_accepting_wishes:
            raise serializers.ValidationError("This cycle is no longer accepting wishes.")
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
                    raise serializers.ValidationError(f"Invalid date format: {d}") from e
            elif isinstance(d, date):
                validated.append(d.isoformat())
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
            raise serializers.ValidationError("Cycle not found.") from e

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
