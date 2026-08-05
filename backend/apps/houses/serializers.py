"""
Serializers for House models.
"""

from decimal import Decimal

from rest_framework import serializers

from apps.users.models import User
from apps.users.serializer_mixins import AvatarUrlMixin

from .models import Car, Child, House


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


# What a car *is*. Also used by carsharing.SharedCarSerializer, so a new attribute
# cannot show up in the owner's editor and be missing from the borrower's list.
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
    "practical_note",
]

# Delebilpark fields, shared by the read and write serializers so the two can't drift.
CAR_SHARING_FIELDS = [
    "is_shared",
    "rate_per_km",
    *CAR_SPEC_FIELDS,
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
        min_value=Decimal("0.01"),
        error_messages={
            "invalid": "Angiv en gyldig km-takst, fx 3,94.",
            "min_value": "Km-taksten skal være et positivt beløb.",
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
