"""
Serializers for Events app.
"""

from datetime import timedelta

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import serializers

from apps.bookings.models import Room
from apps.bookings.validators import check_multi_room_booking
from apps.users.models import User

from .models import Event, EventAttendance

MAX_DURATION_HOURS = 30


class AuthorSerializer(serializers.ModelSerializer):
    """Minimal serializer for event creators."""

    class Meta:
        model = User
        fields = ["id", "first_name", "last_name", "profile_picture"]


class RoomInfoSerializer(serializers.Serializer):
    """Inline room info for event responses."""

    id = serializers.IntegerField()
    name = serializers.CharField()
    color = serializers.CharField()


class SubgroupInfoSerializer(serializers.Serializer):
    """Inline subgroup info for event responses."""

    id = serializers.IntegerField()
    name = serializers.CharField()
    slug = serializers.CharField()


class FolderInfoSerializer(serializers.Serializer):
    """Inline folder info for event responses."""

    id = serializers.IntegerField()
    name = serializers.CharField()


class AttendanceSerializer(serializers.ModelSerializer):
    """Serializes attendance with user/child info."""

    user = AuthorSerializer(read_only=True)
    child_id = serializers.IntegerField(source="child.id", read_only=True, default=None)
    child_name = serializers.CharField(source="child.name", read_only=True, default=None)

    class Meta:
        model = EventAttendance
        fields = ["id", "user", "child_id", "child_name", "status", "updated_at"]


class EventSerializer(serializers.ModelSerializer):
    """Read serializer for Event model."""

    created_by = AuthorSerializer(read_only=True)
    rooms = RoomInfoSerializer(many=True, read_only=True)
    subgroup = SubgroupInfoSerializer(read_only=True)
    folder = FolderInfoSerializer(read_only=True)
    is_own = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    rsvp_summary = serializers.SerializerMethodField()
    my_rsvp = serializers.SerializerMethodField()
    household_rsvps = serializers.SerializerMethodField()
    resolved_location = serializers.CharField(read_only=True)
    thread_id = serializers.IntegerField(read_only=True, allow_null=True)
    thread_subgroup_slug = serializers.SerializerMethodField()
    thread_slug = serializers.SerializerMethodField()

    class Meta:
        model = Event
        fields = [
            "id",
            "slug",
            "title",
            "description",
            "created_by",
            "visibility",
            "start_datetime",
            "end_datetime",
            "rooms",
            "location",
            "resolved_location",
            "subgroup",
            "folder",
            "rsvp_enabled",
            "rsvp_deadline",
            "rsvp_summary",
            "my_rsvp",
            "household_rsvps",
            "is_own",
            "can_edit",
            "is_cancelled",
            "cancellation_message",
            "resolved_location",
            "thread_id",
            "thread_subgroup_slug",
            "thread_slug",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "slug",
            "created_by",
            "is_cancelled",
            "cancellation_message",
            "resolved_location",
            "thread_id",
            "thread_subgroup_slug",
            "thread_slug",
            "created_at",
            "updated_at",
        ]

    def get_thread_subgroup_slug(self, obj: Event) -> str | None:
        if obj.thread_id and obj.thread.subgroup_id:
            return obj.thread.subgroup.slug
        return None

    def get_thread_slug(self, obj: Event) -> str | None:
        if obj.thread_id:
            return obj.thread.slug
        return None

    def get_is_own(self, obj: Event) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.created_by_id == request.user.id
        return False

    def get_can_edit(self, obj: Event) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.created_by_id == request.user.id or request.user.is_staff
        return False

    def get_rsvp_summary(self, obj: Event) -> dict | None:
        if not obj.rsvp_enabled:
            return None
        counts = obj.attendances.aggregate(
            attending=Count("id", filter=Q(status=EventAttendance.Status.ATTENDING)),
            not_attending=Count("id", filter=Q(status=EventAttendance.Status.NOT_ATTENDING)),
            not_answered=Count("id", filter=Q(status=EventAttendance.Status.NOT_ANSWERED)),
        )
        return counts

    def get_my_rsvp(self, obj: Event) -> str | None:
        if not obj.rsvp_enabled:
            return None
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return None
        attendance = obj.attendances.filter(user=request.user).first()
        if attendance:
            return attendance.status
        return None

    def get_household_rsvps(self, obj: Event) -> list | None:
        if not obj.rsvp_enabled:
            return None
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return None
        user = request.user
        if not user.house_id:
            # User has no house — only return their own attendance
            qs = obj.attendances.filter(user=user)
        else:
            # Return attendances for all household members (adults + children)
            qs = obj.attendances.filter(
                Q(user__house_id=user.house_id) | Q(child__house_id=user.house_id)
            )
        return AttendanceSerializer(qs, many=True).data


class EventCreateUpdateSerializer(serializers.ModelSerializer):
    """Write serializer for creating/updating events."""

    room_ids = serializers.ListField(
        child=serializers.IntegerField(),
        write_only=True,
        required=False,
        default=list,
    )
    subgroup_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)

    class Meta:
        model = Event
        fields = [
            "id",
            "title",
            "description",
            "visibility",
            "start_datetime",
            "end_datetime",
            "room_ids",
            "location",
            "subgroup_id",
            "rsvp_enabled",
            "rsvp_deadline",
        ]
        read_only_fields = ["id"]

    def validate(self, data: dict) -> dict:
        # For partial updates, use instance values as fallback
        start = data.get("start_datetime")
        end = data.get("end_datetime")
        if self.instance:
            if start is None:
                start = self.instance.start_datetime
            if end is None:
                end = self.instance.end_datetime

        if start and end and end <= start:
            raise serializers.ValidationError(
                {"end_datetime": "Sluttidspunkt skal være efter starttidspunkt."}
            )

        visibility = data.get("visibility", getattr(self.instance, "visibility", "community"))

        # Prevent creating private bookings in the past (allow edits; community events may be any time)
        if (
            not self.instance
            and visibility == Event.Visibility.PRIVATE
            and start
            and start < timezone.now()
        ):
            raise serializers.ValidationError(
                {"start_datetime": "Starttidspunkt kan ikke være i fortiden."}
            )

        # Private booking validations
        if visibility == Event.Visibility.PRIVATE and start and end:
            duration = end - start
            if duration > timedelta(hours=MAX_DURATION_HOURS):
                raise serializers.ValidationError(
                    {"end_datetime": f"Booking må maksimalt vare {MAX_DURATION_HOURS} timer."}
                )

        # RSVP deadline validation
        rsvp_deadline = data.get("rsvp_deadline")
        rsvp_enabled = data.get("rsvp_enabled", getattr(self.instance, "rsvp_enabled", False))
        if rsvp_enabled and rsvp_deadline:
            if not self.instance and rsvp_deadline < timezone.now():
                raise serializers.ValidationError(
                    {"rsvp_deadline": "Svarfristen kan ikke være i fortiden."}
                )
            if start and rsvp_deadline > start:
                raise serializers.ValidationError(
                    {"rsvp_deadline": "Svarfristen skal være før begivenhedens start."}
                )

        # Room overlap validation
        room_ids = data.get("room_ids", [])
        if room_ids and start and end:
            exclude_id = self.instance.id if self.instance else None
            result = check_multi_room_booking(room_ids, start, end, exclude_id)
            if not result["can_book_all"]:
                error_messages = []
                for rid, conflicts in result["conflicts_by_room"].items():
                    room = Room.objects.get(id=rid)
                    error_messages.append(f"{room.name}: {'; '.join(conflicts)}")
                raise serializers.ValidationError({"non_field_errors": error_messages})

        return data

    def create(self, validated_data: dict) -> Event:
        room_ids = validated_data.pop("room_ids", [])
        subgroup_id = validated_data.pop("subgroup_id", None)

        user = self.context["request"].user
        validated_data["created_by"] = user

        start = validated_data.get("start_datetime")
        end = validated_data.get("end_datetime")

        with transaction.atomic():
            # Re-check room overlap inside transaction
            if room_ids:
                result = check_multi_room_booking(room_ids, start, end, None)
                if not result["can_book_all"]:
                    error_messages = []
                    for rid, conflicts in result["conflicts_by_room"].items():
                        room = Room.objects.get(id=rid)
                        error_messages.append(f"{room.name}: {'; '.join(conflicts)}")
                    raise serializers.ValidationError({"non_field_errors": error_messages})

            from apps.forum.models import Subgroup

            if subgroup_id:
                validated_data["subgroup"] = Subgroup.objects.get(id=subgroup_id)
            else:
                validated_data["subgroup"], _ = Subgroup.objects.get_or_create(
                    slug="arrangementer",
                    defaults={
                        "name": "Arrangementer",
                        "description": "Diskussioner om arrangementer",
                    },
                )

            event = Event.objects.create(**validated_data)

            if room_ids:
                event.rooms.set(room_ids)

        return event

    def update(self, instance: Event, validated_data: dict) -> Event:
        room_ids = validated_data.pop("room_ids", None)  # None = not provided (partial update)
        subgroup_id = validated_data.pop("subgroup_id", None)

        start = validated_data.get("start_datetime", instance.start_datetime)
        end = validated_data.get("end_datetime", instance.end_datetime)

        with transaction.atomic():
            # Re-check room overlap if rooms are being set
            current_ids = list(instance.rooms.values_list("id", flat=True))
            ids_to_check = room_ids if room_ids is not None else current_ids
            if ids_to_check:
                result = check_multi_room_booking(ids_to_check, start, end, instance.id)
                if not result["can_book_all"]:
                    error_messages = []
                    for rid, conflicts in result["conflicts_by_room"].items():
                        room = Room.objects.get(id=rid)
                        error_messages.append(f"{room.name}: {'; '.join(conflicts)}")
                    raise serializers.ValidationError({"non_field_errors": error_messages})

            if subgroup_id is not None:
                from apps.forum.models import Subgroup

                if subgroup_id:
                    instance.subgroup = Subgroup.objects.get(id=subgroup_id)
                else:
                    instance.subgroup = None

            for attr, value in validated_data.items():
                setattr(instance, attr, value)
            instance.save()

            if room_ids is not None:
                instance.rooms.set(room_ids)

        return instance


class RsvpItemSerializer(serializers.Serializer):
    """Single RSVP item in a batch submission."""

    user_id = serializers.IntegerField(required=False)
    child_id = serializers.IntegerField(required=False)
    status = serializers.ChoiceField(choices=EventAttendance.Status.choices)

    def validate(self, data: dict) -> dict:
        if not data.get("user_id") and not data.get("child_id"):
            raise serializers.ValidationError("Enten user_id eller child_id er påkrævet.")
        if data.get("user_id") and data.get("child_id"):
            raise serializers.ValidationError("Kun én af user_id eller child_id må angives.")
        return data


class RsvpSubmitSerializer(serializers.Serializer):
    """Validates RSVP batch payload."""

    attendances = RsvpItemSerializer(many=True)


class HouseholdMemberSerializer(serializers.Serializer):
    """Returns household members for RSVP form."""

    type = serializers.CharField()  # "adult" or "child"
    id = serializers.IntegerField()
    name = serializers.CharField()
    current_status = serializers.CharField(allow_null=True)


class EventCancelSerializer(serializers.Serializer):
    """Validates event cancellation payload."""

    cancellation_message = serializers.CharField(
        max_length=500, required=False, allow_blank=True, default=""
    )
