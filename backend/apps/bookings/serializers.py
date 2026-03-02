"""
Serializers for Bookings models (Room, RecurringBooking, calendar display).
"""

from rest_framework import serializers

from apps.users.models import User

from .models import RecurringBooking, RecurringBookingException, Room


class UserSerializer(serializers.ModelSerializer):
    """Minimal serializer for booking users."""

    class Meta:
        model = User
        fields = ["id", "first_name", "last_name", "profile_picture"]


class RoomSerializer(serializers.ModelSerializer):
    """Serializer for Room model."""

    class Meta:
        model = Room
        fields = [
            "id",
            "name",
            "description",
            "image",
            "color",
            "is_active",
            "sort_order",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class RoomCreateUpdateSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating rooms (admin only)."""

    class Meta:
        model = Room
        fields = [
            "name",
            "description",
            "image",
            "color",
            "is_active",
            "sort_order",
        ]


class BookingRoomSerializer(serializers.ModelSerializer):
    """Minimal room serializer for nested use in bookings."""

    class Meta:
        model = Room
        fields = ["id", "name", "color"]


class RecurringBookingSerializer(serializers.ModelSerializer):
    """Serializer for RecurringBooking model."""

    room = BookingRoomSerializer(read_only=True)
    created_by = UserSerializer(read_only=True)
    days_of_week_display = serializers.ReadOnlyField()

    class Meta:
        model = RecurringBooking
        fields = [
            "id",
            "room",
            "created_by",
            "title",
            "description",
            "days_of_week",
            "days_of_week_display",
            "start_time",
            "end_time",
            "effective_from",
            "effective_until",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "room", "created_by", "created_at", "updated_at"]


class RecurringBookingCreateUpdateSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating recurring bookings (admin only)."""

    room_id = serializers.IntegerField(write_only=True)
    days_of_week = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=6),
        min_length=1,
        help_text="List of day integers (0=Monday, 6=Sunday)",
    )

    class Meta:
        model = RecurringBooking
        fields = [
            "room_id",
            "title",
            "description",
            "days_of_week",
            "start_time",
            "end_time",
            "effective_from",
            "effective_until",
            "is_active",
        ]

    def validate_days_of_week(self, value: list) -> list:
        # Ensure unique and sorted
        return sorted(set(value))

    def validate(self, data: dict) -> dict:
        # Validate dates
        effective_from = data.get("effective_from")
        effective_until = data.get("effective_until")
        if effective_from and effective_until and effective_until < effective_from:
            raise serializers.ValidationError(
                {"effective_until": "Slutdato skal være efter startdato."}
            )

        return data

    def create(self, validated_data: dict) -> RecurringBooking:
        room_id = validated_data.pop("room_id")
        room = Room.objects.get(id=room_id)
        validated_data["room"] = room
        validated_data["created_by"] = self.context["request"].user
        return super().create(validated_data)

    def update(self, instance: RecurringBooking, validated_data: dict) -> RecurringBooking:
        room_id = validated_data.pop("room_id", None)
        if room_id:
            instance.room = Room.objects.get(id=room_id)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        return instance


class RecurringBookingExceptionSerializer(serializers.ModelSerializer):
    """Serializer for creating single occurrence exceptions."""

    class Meta:
        model = RecurringBookingException
        fields = ["id", "recurring_booking", "exception_date", "created_at"]
        read_only_fields = ["id", "created_at"]


class CalendarBookingSerializer(serializers.Serializer):
    """Lightweight serializer for calendar display (events + recurring occurrences)."""

    id = serializers.CharField()
    event_slug = serializers.CharField(required=False, allow_null=True, default=None)
    room = BookingRoomSerializer()
    user = UserSerializer()
    title = serializers.CharField()
    description = serializers.CharField()
    start_datetime = serializers.DateTimeField()
    end_datetime = serializers.DateTimeField()
    is_recurring = serializers.BooleanField(default=False)
    recurring_booking_id = serializers.IntegerField(required=False, allow_null=True)
    is_own = serializers.SerializerMethodField()

    def get_is_own(self, obj: dict) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            user_data = obj.get("user", {})
            return user_data.get("id") == request.user.id
        return False


class AvailabilityCheckSerializer(serializers.Serializer):
    """Serializer for availability check request."""

    room_ids = serializers.ListField(child=serializers.IntegerField())
    start_datetime = serializers.DateTimeField()
    end_datetime = serializers.DateTimeField()
    exclude_event_id = serializers.IntegerField(required=False, allow_null=True)
