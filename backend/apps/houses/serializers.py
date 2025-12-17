"""
Serializers for House models.
"""

from rest_framework import serializers

from apps.users.models import User

from .models import Child, House


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
        ]


class HouseSerializer(serializers.ModelSerializer):
    """Serializer for House model."""

    inhabitants = HouseInhabitantSerializer(many=True, read_only=True)
    children = ChildSerializer(many=True, read_only=True)
    inhabitant_count = serializers.SerializerMethodField()

    class Meta:
        model = House
        fields = [
            "id",
            "name",
            "description",
            "address",
            "profile_picture",
            "inhabitants",
            "children",
            "inhabitant_count",
            "created_at",
        ]

    def get_inhabitant_count(self, obj: House) -> int:
        """Get the number of inhabitants in the house."""
        return obj.inhabitants.count()


class HouseListSerializer(serializers.ModelSerializer):
    """Serializer for House list with inhabitant preview."""

    inhabitants = HouseInhabitantSerializer(many=True, read_only=True)
    children = ChildSerializer(many=True, read_only=True)
    inhabitant_count = serializers.SerializerMethodField()

    class Meta:
        model = House
        fields = [
            "id",
            "name",
            "description",
            "address",
            "profile_picture",
            "inhabitants",
            "children",
            "inhabitant_count",
        ]

    def get_inhabitant_count(self, obj: House) -> int:
        """Get the number of inhabitants in the house."""
        # Use annotated count if available (from view queryset), otherwise count
        if hasattr(obj, "inhabitant_count_annotated"):
            return obj.inhabitant_count_annotated
        return obj.inhabitants.count()


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
