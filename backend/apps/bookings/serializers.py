"""
Serializers for Bookings models.
"""

from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from apps.users.models import User

from .models import Booking, RecurringBooking, RecurringBookingException, Room
from .validators import check_multi_room_booking


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


class BookingSerializer(serializers.ModelSerializer):
    """Serializer for Booking model."""

    room = BookingRoomSerializer(read_only=True)
    user = UserSerializer(read_only=True)
    is_own = serializers.SerializerMethodField()
    duration_hours = serializers.ReadOnlyField()

    class Meta:
        model = Booking
        fields = [
            "id",
            "room",
            "user",
            "title",
            "description",
            "start_datetime",
            "end_datetime",
            "duration_hours",
            "is_own",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "room", "user", "created_at", "updated_at"]

    def get_is_own(self, obj: Booking) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.user_id == request.user.id
        return False


class BookingCreateUpdateSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating bookings."""

    room_id = serializers.IntegerField(write_only=True, required=False)
    room_ids = serializers.ListField(
        child=serializers.IntegerField(),
        write_only=True,
        required=False,
        help_text="For creating multiple bookings at once",
    )

    class Meta:
        model = Booking
        fields = [
            "room_id",
            "room_ids",
            "title",
            "description",
            "start_datetime",
            "end_datetime",
        ]

    def validate(self, data: dict) -> dict:
        start = data.get("start_datetime")
        end = data.get("end_datetime")
        room_id = data.get("room_id")
        room_ids = data.get("room_ids", [])

        # Require either room_id or room_ids
        if not room_id and not room_ids:
            raise serializers.ValidationError({"room_id": "Vælg venligst et lokale."})

        # Use room_id if provided, otherwise use room_ids
        if room_id:
            room_ids = [room_id]

        # Validate times
        if end and start:
            if end <= start:
                raise serializers.ValidationError(
                    {"end_datetime": "Sluttidspunkt skal være efter starttidspunkt."}
                )

            # Check max duration
            duration = end - start
            max_duration = timedelta(hours=Booking.MAX_DURATION_HOURS)
            if duration > max_duration:
                raise serializers.ValidationError(
                    {
                        "end_datetime": (
                            f"Booking må maksimalt vare {Booking.MAX_DURATION_HOURS} timer."
                        )
                    }
                )

            # Check not in the past
            if start < timezone.now():
                raise serializers.ValidationError(
                    {"start_datetime": "Starttidspunkt kan ikke være i fortiden."}
                )

        # Check for overlaps
        exclude_id = self.instance.id if self.instance else None
        result = check_multi_room_booking(room_ids, start, end, exclude_id)

        if not result["can_book_all"]:
            # Build error message with conflicts
            error_messages = []
            for rid, conflicts in result["conflicts_by_room"].items():
                room = Room.objects.get(id=rid)
                error_messages.append(f"{room.name}: {'; '.join(conflicts)}")
            raise serializers.ValidationError({"non_field_errors": error_messages})

        # Store validated room_ids for create
        data["_room_ids"] = room_ids
        return data

    def create(self, validated_data: dict) -> Booking:
        room_ids = validated_data.pop("_room_ids")
        validated_data.pop("room_id", None)
        validated_data.pop("room_ids", None)

        user = self.context["request"].user

        # Create booking for first room (or only room)
        first_room = Room.objects.get(id=room_ids[0])
        booking = Booking.objects.create(
            room=first_room,
            user=user,
            **validated_data,
        )

        # Create additional bookings for other rooms
        for room_id in room_ids[1:]:
            room = Room.objects.get(id=room_id)
            Booking.objects.create(
                room=room,
                user=user,
                **validated_data,
            )

        return booking

    def update(self, instance: Booking, validated_data: dict) -> Booking:
        validated_data.pop("_room_ids", None)
        validated_data.pop("room_id", None)
        validated_data.pop("room_ids", None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        return instance


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
    """Lightweight serializer for calendar display."""

    id = serializers.CharField()
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
    exclude_booking_id = serializers.IntegerField(required=False, allow_null=True)
