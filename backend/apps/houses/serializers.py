"""
Serializers for House models.
"""

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


# Car pool fields, shared by the read and write serializers so the two can't drift.
CAR_POOL_FIELDS = [
    "in_pool",
    "rate_per_km",
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


class CarSerializer(serializers.ModelSerializer):
    """Serializer for Car model."""

    display_name = serializers.CharField(read_only=True)

    class Meta:
        model = Car
        fields = [
            "id",
            "license_plate",
            "is_electric",
            "display_name",
            *CAR_POOL_FIELDS,
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class CarCreateUpdateSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating cars."""

    class Meta:
        model = Car
        fields = [
            "id",
            "license_plate",
            "is_electric",
            *CAR_POOL_FIELDS,
        ]
        read_only_fields = ["id"]

    def validate(self, attrs):
        """Mirror Car.clean() — DRF never calls full_clean(), so admin and API
        would otherwise disagree about whether a pooled car needs a plate."""
        from .utils import normalize_license_plate

        in_pool = attrs.get("in_pool", getattr(self.instance, "in_pool", False))
        plate = attrs.get("license_plate", getattr(self.instance, "license_plate", ""))
        if in_pool and not normalize_license_plate(plate):
            raise serializers.ValidationError(
                {"in_pool": "En bil i bilpølen skal have en nummerplade."}
            )
        return attrs


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
