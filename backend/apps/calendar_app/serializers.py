"""
Serializers for Calendar models.
"""

from rest_framework import serializers

from apps.users.models import User

from .models import Event


class AuthorSerializer(serializers.ModelSerializer):
    """Minimal serializer for event creators."""

    class Meta:
        model = User
        fields = ["id", "first_name", "last_name", "profile_picture"]


class EventSerializer(serializers.ModelSerializer):
    """Serializer for Event model."""

    created_by = AuthorSerializer(read_only=True)
    is_own = serializers.SerializerMethodField()

    class Meta:
        model = Event
        fields = [
            "id",
            "title",
            "description",
            "created_by",
            "start_datetime",
            "end_datetime",
            "location",
            "is_all_day",
            "is_own",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_by", "created_at", "updated_at"]

    def get_is_own(self, obj: Event) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.created_by_id == request.user.id
        return False


class EventCreateUpdateSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating events."""

    class Meta:
        model = Event
        fields = [
            "title",
            "description",
            "start_datetime",
            "end_datetime",
            "location",
            "is_all_day",
        ]

    def validate(self, data: dict) -> dict:
        # For partial updates, use instance values as fallback
        start = data.get("start_datetime")
        end = data.get("end_datetime")
        if self.instance:
            if start is None:
                start = self.instance.start_datetime
            if end is None:
                end = self.instance.end_datetime
        if start and end and end < start:
            raise serializers.ValidationError(
                {"end_datetime": "Sluttidspunkt skal være efter starttidspunkt."}
            )
        return data

    def create(self, validated_data: dict) -> Event:
        validated_data["created_by"] = self.context["request"].user
        return super().create(validated_data)
