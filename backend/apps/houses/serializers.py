"""
Serializers for House models.
"""

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.users.models import Invitation, User
from apps.users.serializer_mixins import AvatarUrlMixin

from .models import Car, Child, Handover, House


class ChildSerializer(AvatarUrlMixin, serializers.ModelSerializer):
    """Serializer for Child model."""

    class Meta:
        model = Child
        fields = [
            "id",
            "name",
            "birthdate",
            "profile_picture",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class ChildCreateUpdateSerializer(AvatarUrlMixin, serializers.ModelSerializer):
    """Serializer for creating/updating children."""

    class Meta:
        model = Child
        fields = [
            "id",
            "name",
            "birthdate",
            "profile_picture",
        ]
        read_only_fields = ["id"]


# What a car *is*, to anyone who may see it. Also used by
# carsharing.SharedCarSerializer, so a new attribute cannot show up in the owner's
# editor and be missing from the borrower's list.
#
# practical_note is deliberately *not* here: it says where the key and the charge
# fob are kept. CarLoanSerializer withholds that string from households who are
# not party to a loan, and the borrow list used to hand it to every resident for
# every shared car, undoing that. Anything added here is public to the community;
# put owner-only fields in CAR_OWNER_SPEC_FIELDS instead.
CAR_SPEC_FIELDS = [
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
]

# What the owning household sees and edits: the public spec plus where the key is.
CAR_OWNER_SPEC_FIELDS = [
    *CAR_SPEC_FIELDS,
    "practical_note",
]

# Delebilpark fields, shared by the read and write serializers so the two can't drift.
CAR_SHARING_FIELDS = [
    "is_shared",
    "rate_per_km",
    *CAR_OWNER_SPEC_FIELDS,
]


class CarSerializer(serializers.ModelSerializer):
    """Serializer for Car model."""

    display_name = serializers.CharField(read_only=True)
    # So "Mine biler" can say why a shared car is not actually being offered.
    has_accepted_current_terms = serializers.BooleanField(read_only=True)

    class Meta:
        model = Car
        fields = [
            "id",
            "license_plate",
            "is_electric",
            "display_name",
            *CAR_SHARING_FIELDS,
            "terms_accepted_version",
            "has_accepted_current_terms",
            "created_at",
        ]
        read_only_fields = ["id", "created_at", "terms_accepted_version"]


class CarCreateUpdateSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating cars."""

    # Not a model field: the server decides which version a tick records, so the
    # client can never claim consent to terms other than the ones in force.
    accept_terms = serializers.BooleanField(write_only=True, required=False, default=False)

    # Declared rather than inherited from the model so the bound and the Danish
    # wording live here: a model-level validator would force a migration, and
    # DRF's default message ("A valid number is required.") is the only English
    # string a resident could hit on this form.
    rate_per_km = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        required=False,
        allow_null=True,
        # 0 is a legitimate rate — lending for free. Empty still means "use the
        # community default"; 0 means "this one is on me".
        min_value=Decimal("0"),
        error_messages={
            "invalid": "Angiv en gyldig km-takst, fx 3,94.",
            "min_value": "Km-taksten kan ikke være negativ.",
            # The plausible typo is 1000 for 10,00, and DRF answered it with
            # "Ensure that there are no more than 3 digits before the decimal
            # point." Both digit bounds say the same thing to an owner.
            "max_digits": "Km-taksten er for høj — skriv højst 999,99.",
            "max_whole_digits": "Km-taksten er for høj — skriv højst 999,99.",
            "max_decimal_places": "Skriv km-taksten med højst to decimaler.",
        },
    )

    class Meta:
        model = Car
        fields = [
            "id",
            "license_plate",
            "is_electric",
            *CAR_SHARING_FIELDS,
            "accept_terms",
        ]
        read_only_fields = ["id"]

    def validate(self, attrs):
        """Mirror Car.clean() — DRF never calls full_clean(), so admin and API
        would otherwise disagree about whether a shared car needs a plate.

        Also the gate on lending: a car may only be offered by a household that
        has accepted the terms currently in force.
        """
        from apps.carsharing.constants import TERMS_VERSION

        from .utils import normalize_license_plate

        is_shared = attrs.get("is_shared", getattr(self.instance, "is_shared", False))
        plate = attrs.get("license_plate", getattr(self.instance, "license_plate", ""))
        if is_shared and not normalize_license_plate(plate):
            raise serializers.ValidationError(
                {"is_shared": "En bil i delebilparken skal have en nummerplade."}
            )

        already_accepted = bool(
            self.instance is not None and self.instance.has_accepted_current_terms
        )
        if is_shared and not attrs.get("accept_terms") and not already_accepted:
            raise serializers.ValidationError(
                {
                    "accept_terms": (
                        f"Du skal bekræfte vilkårene ({TERMS_VERSION}) for at have "
                        "bilen i delebilparken."
                    )
                }
            )
        return attrs

    def _stamp_consent(self, validated_data):
        """Turn a tick into a recorded version, and drop the transient flag."""
        from django.utils import timezone

        from apps.carsharing.constants import TERMS_VERSION

        if validated_data.pop("accept_terms", False):
            validated_data["terms_accepted_version"] = TERMS_VERSION
            validated_data["terms_accepted_at"] = timezone.now()
        return validated_data

    def create(self, validated_data):
        return super().create(self._stamp_consent(validated_data))

    def update(self, instance, validated_data):
        return super().update(instance, self._stamp_consent(validated_data))


class HouseInhabitantSerializer(AvatarUrlMixin, serializers.ModelSerializer):
    """Serializer for users as house inhabitants (minimal info)."""

    # Same as UserSerializer: the year is left out for those who hide it.
    birthdate = serializers.CharField(source="public_birthdate", read_only=True, allow_null=True)

    class Meta:
        model = User
        fields = [
            "id",
            "first_name",
            "last_name",
            "profile_picture",
            "bio",
            "phone_number",
            "email",
            "birthdate",
        ]


class HouseSerializer(AvatarUrlMixin, serializers.ModelSerializer):
    """Serializer for House model."""

    inhabitants = HouseInhabitantSerializer(many=True, read_only=True)
    children = ChildSerializer(many=True, read_only=True)
    cars = CarSerializer(many=True, read_only=True)
    inhabitant_count = serializers.SerializerMethodField()

    class Meta:
        model = House
        fields = [
            "id",
            "slug",
            "name",
            "description",
            "address",
            "profile_picture",
            "inhabitants",
            "children",
            "cars",
            "inhabitant_count",
            "created_at",
        ]
        read_only_fields = ["slug"]

    def get_inhabitant_count(self, obj: House) -> int:
        """Get the number of inhabitants in the house.

        Uses len() on prefetched queryset to avoid extra database queries.
        """
        # Use len() to leverage prefetch_related, .count() would hit DB again
        return len(obj.inhabitants.all())


class HouseListSerializer(AvatarUrlMixin, serializers.ModelSerializer):
    """Serializer for House list with inhabitant preview."""

    inhabitants = HouseInhabitantSerializer(many=True, read_only=True)
    children = ChildSerializer(many=True, read_only=True)
    cars = CarSerializer(many=True, read_only=True)
    inhabitant_count = serializers.SerializerMethodField()

    class Meta:
        model = House
        fields = [
            "id",
            "slug",
            "name",
            "description",
            "address",
            "profile_picture",
            "inhabitants",
            "children",
            "cars",
            "inhabitant_count",
        ]
        read_only_fields = ["slug"]

    def get_inhabitant_count(self, obj: House) -> int:
        """Get the number of inhabitants in the house.

        Uses len() on prefetched queryset to avoid extra database queries.
        If an annotated count is available (from view queryset), use that instead.
        """
        if hasattr(obj, "inhabitant_count_annotated"):
            return obj.inhabitant_count_annotated
        # Use len() to leverage prefetch_related, .count() would hit DB again
        return len(obj.inhabitants.all())


class HouseUpdateSerializer(AvatarUrlMixin, serializers.ModelSerializer):
    """Serializer for updating a house's description and profile picture."""

    class Meta:
        model = House
        fields = [
            "id",
            "name",
            "description",
            "address",
            "profile_picture",
        ]
        read_only_fields = ["id", "name", "address"]


class HandoverOutgoingSerializer(serializers.ModelSerializer):
    """A resident moving out, with the maddage they still hold after moving."""

    upcoming_food_shifts = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "first_name",
            "last_name",
            "is_active",
            "moved_out_on",
            "upcoming_food_shifts",
        ]

    def get_upcoming_food_shifts(self, obj: User) -> list[str]:
        """Maddage on or after the handover day: the move takes them off those
        teams, so the admin can find a replacement in time. Empty once moved."""
        from apps.food.models import FoodTeamMember

        handover = self.context["handover"]
        if handover.moved_out_at:
            return []
        today = timezone.localdate()
        first = max(handover.handover_date, today + timedelta(days=1))
        dates = FoodTeamMember.objects.filter(user=obj, team__date__gte=first).values_list(
            "team__date", flat=True
        )
        return [d.isoformat() for d in sorted(dates)]


class HandoverInvitationSerializer(serializers.ModelSerializer):
    """A resident moving in: their invitation and how far it has got."""

    status = serializers.SerializerMethodField()

    class Meta:
        model = Invitation
        fields = [
            "id",
            "first_name",
            "last_name",
            "email",
            "phone_number",
            "send_on",
            "sent_at",
            "used_at",
            "expires_at",
            "status",
        ]

    def get_status(self, obj: Invitation) -> str:
        if obj.used_at:
            return "registered"
        if not obj.sent_at:
            return "scheduled"
        return "sent" if obj.is_valid else "expired"


class HandoverSerializer(serializers.ModelSerializer):
    house_name = serializers.CharField(source="house.name", read_only=True)
    house_slug = serializers.CharField(source="house.slug", read_only=True)
    outgoing = serializers.SerializerMethodField()
    invitations = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    can_cancel = serializers.SerializerMethodField()

    class Meta:
        model = Handover
        fields = [
            "id",
            "house",
            "house_name",
            "house_slug",
            "handover_date",
            "invite_on",
            "access_until",
            "reset_household",
            "outgoing",
            "invitations",
            "created_by_name",
            "created_at",
            "household_reset_at",
            "moved_out_at",
            "access_ended_at",
            "can_cancel",
        ]

    def get_outgoing(self, obj: Handover) -> list[dict]:
        return HandoverOutgoingSerializer(
            obj.outgoing.all(), many=True, context={"handover": obj}
        ).data

    def get_invitations(self, obj: Handover) -> list[dict]:
        return HandoverInvitationSerializer(obj.invitations.order_by("id"), many=True).data

    def get_created_by_name(self, obj: Handover) -> str:
        return obj.created_by.get_full_name() if obj.created_by else ""

    def get_can_cancel(self, obj: Handover) -> bool:
        return not obj.has_started


class HandoverIncomingSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150, allow_blank=True, default="")
    email = serializers.EmailField()
    phone_number = serializers.CharField(max_length=20, allow_blank=True, default="")

    def validate_email(self, value: str) -> str:
        return value.strip().lower()


def _invitation_problem(email: str) -> str | None:
    """Why this address can't be invited, or None. Checked on the handover rather
    than per person, so the message names the address: DRF's nested list errors
    reach the page as one string per field, not per row."""
    if User.objects.filter(email__iexact=email).exists():
        return f"{email} har allerede en bruger."
    # On its way: still usable, or waiting for its handover's send day.
    waiting = Invitation.objects.filter(email__iexact=email, used_at__isnull=True)
    if any(inv.is_valid or (inv.send_on and not inv.sent_at) for inv in waiting):
        return f"{email} har allerede en invitation på vej."
    return None


def _validate_dates(handover_date: date, access_until: date) -> None:
    if access_until < handover_date:
        raise serializers.ValidationError(
            {"access_until": "Adgangen kan ikke slutte før overtagelsesdagen."}
        )


class HandoverCreateSerializer(serializers.Serializer):
    """Register a handover: who moves out, who moves in, and the dates.

    Saving only records it; the view then runs whatever is already due.
    """

    house = serializers.SlugRelatedField(slug_field="slug", queryset=House.objects.all())
    handover_date = serializers.DateField()
    invite_on = serializers.DateField(required=False)
    access_until = serializers.DateField()
    reset_household = serializers.BooleanField(default=False)
    outgoing = serializers.PrimaryKeyRelatedField(
        many=True, queryset=User.objects.filter(is_active=True), required=False, default=list
    )
    incoming = HandoverIncomingSerializer(many=True, required=False, default=list)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        house: House = attrs["house"]
        outgoing: list[User] = attrs["outgoing"]
        incoming: list[dict] = attrs["incoming"]
        attrs.setdefault("invite_on", attrs["handover_date"])
        _validate_dates(attrs["handover_date"], attrs["access_until"])

        if not outgoing and not incoming:
            raise serializers.ValidationError(
                "Vælg nogen, der flytter ud, eller tilføj nogen, der flytter ind."
            )
        for user in outgoing:
            if user.house_id != house.id:
                raise serializers.ValidationError(
                    {"outgoing": f"{user.get_full_name()} bor ikke i {house.name}."}
                )
        already = Handover.objects.filter(moved_out_at__isnull=True, outgoing__in=outgoing).exists()
        if already:
            raise serializers.ValidationError(
                {"outgoing": "En af beboerne er allerede med i en anden fraflytning."}
            )
        if attrs["reset_household"]:
            staying = house.inhabitants.filter(is_active=True).exclude(
                pk__in=[u.pk for u in outgoing]
            )
            if staying.exists():
                raise serializers.ValidationError(
                    {
                        "reset_household": (
                            "Husets oplysninger kan kun nulstilles, når alle beboere flytter ud."
                        )
                    }
                )
        emails = [person["email"] for person in incoming]
        if len(emails) != len(set(emails)):
            raise serializers.ValidationError(
                {"incoming": "Den samme emailadresse står der to gange."}
            )
        problems = [p for p in map(_invitation_problem, emails) if p]
        if problems:
            raise serializers.ValidationError({"incoming": problems})
        return attrs

    def create(self, validated_data: dict[str, Any]) -> Handover:
        request = self.context["request"]
        incoming = validated_data.pop("incoming")
        outgoing = validated_data.pop("outgoing")
        with transaction.atomic():
            handover = Handover.objects.create(created_by=request.user, **validated_data)
            handover.outgoing.set(outgoing)
            for person in incoming:
                Invitation.objects.create(
                    house=handover.house,
                    handover=handover,
                    send_on=handover.invite_on,
                    created_by=request.user,
                    **person,
                )
        return handover


class HandoverUpdateSerializer(serializers.ModelSerializer):
    """Move a date that hasn't come yet. A step that has run can't be re-dated."""

    class Meta:
        model = Handover
        fields = ["handover_date", "invite_on", "access_until"]

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        handover = self.instance
        assert handover is not None
        if "handover_date" in attrs and handover.moved_out_at:
            raise serializers.ValidationError({"handover_date": "Beboerne er allerede flyttet ud."})
        invited = handover.invitations.filter(sent_at__isnull=False).exists()
        if "invite_on" in attrs and (invited or handover.household_reset_at):
            raise serializers.ValidationError({"invite_on": "Invitationerne er allerede sendt."})
        if "access_until" in attrs and handover.access_ended_at:
            raise serializers.ValidationError({"access_until": "Adgangen er allerede lukket."})
        _validate_dates(
            attrs.get("handover_date", handover.handover_date),
            attrs.get("access_until", handover.access_until),
        )
        return attrs

    def update(self, instance: Handover, validated_data: dict[str, Any]) -> Handover:
        with transaction.atomic():
            handover = super().update(instance, validated_data)
            if "invite_on" in validated_data:
                handover.invitations.filter(sent_at__isnull=True).update(send_on=handover.invite_on)
        return handover
