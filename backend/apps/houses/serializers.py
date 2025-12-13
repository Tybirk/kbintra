"""
Serializers for House models.
"""

from rest_framework import serializers

from apps.users.models import User

from .models import House


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
            "inhabitant_count",
            "created_at",
        ]

    def get_inhabitant_count(self, obj: House) -> int:
        """Get the number of inhabitants in the house."""
        return obj.inhabitants.count()


class HouseListSerializer(serializers.ModelSerializer):
    """Serializer for House list (without full inhabitant details)."""

    inhabitant_count = serializers.SerializerMethodField()

    class Meta:
        model = House
        fields = [
            "id",
            "name",
            "description",
            "address",
            "profile_picture",
            "inhabitant_count",
        ]

    def get_inhabitant_count(self, obj: House) -> int:
        """Get the number of inhabitants in the house."""
        return obj.inhabitants.count()
