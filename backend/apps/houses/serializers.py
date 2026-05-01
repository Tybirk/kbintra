"""
Serializers for House models.
"""

from rest_framework import serializers

from apps.users.models import User

from .models import Car, Child, House


class ChildSerializer(serializers.ModelSerializer):
    """Serializer for Child model."""

    class Meta:
        model = Child
        fields = [
            "id",
            "name",
            "birthdate",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class ChildCreateUpdateSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating children."""

    class Meta:
        model = Child
        fields = [
            "id",
            "name",
            "birthdate",
        ]
        read_only_fields = ["id"]


class CarSerializer(serializers.ModelSerializer):
    """Serializer for Car model."""

    class Meta:
        model = Car
        fields = [
            "id",
            "license_plate",
            "is_electric",
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
        ]
        read_only_fields = ["id"]


class HouseInhabitantSerializer(serializers.ModelSerializer):
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


class HouseSerializer(serializers.ModelSerializer):
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


class HouseListSerializer(serializers.ModelSerializer):
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


class HouseUpdateSerializer(serializers.ModelSerializer):
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
