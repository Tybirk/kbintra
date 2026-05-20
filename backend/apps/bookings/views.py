"""
Views for Bookings app — rooms, recurring bookings, calendar display.
"""

from datetime import datetime
from typing import Any

from django.db.models import QuerySet
from rest_framework import generics, permissions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import RecurringBooking, RecurringBookingException, Room
from .serializers import (
    AvailabilityCheckSerializer,
    CalendarBookingSerializer,
    RecurringBookingCreateUpdateSerializer,
    RecurringBookingExceptionSerializer,
    RecurringBookingSerializer,
    RoomCreateUpdateSerializer,
    RoomSerializer,
)
from .validators import check_multi_room_booking, expand_recurring_bookings_for_range


class IsAdminOrReadOnly(permissions.BasePermission):
    """Allow read access to all, write access only to staff."""

    def has_permission(self, request: Request, view: Any) -> bool:
        if request.method in permissions.SAFE_METHODS:
            return True
        return request.user.is_staff


# Room views


class RoomListCreateView(generics.ListCreateAPIView):
    """List all rooms or create a new one (admin only)."""

    permission_classes = [permissions.IsAuthenticated, IsAdminOrReadOnly]

    def get_serializer_class(self) -> type:
        if self.request.method == "POST":
            return RoomCreateUpdateSerializer
        return RoomSerializer

    def get_queryset(self) -> QuerySet[Room]:
        queryset = Room.objects.all()
        # Optionally filter by active status
        active_only = self.request.query_params.get("active")
        if active_only and active_only.lower() == "true":
            queryset = queryset.filter(is_active=True)
        return queryset


class RoomDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Retrieve, update, or delete a room (admin only for write)."""

    permission_classes = [permissions.IsAuthenticated, IsAdminOrReadOnly]
    queryset = Room.objects.all()

    def get_serializer_class(self) -> type:
        if self.request.method in ["PUT", "PATCH"]:
            return RoomCreateUpdateSerializer
        return RoomSerializer


# Recurring booking views (admin only)


class RecurringBookingListCreateView(generics.ListCreateAPIView):
    """List recurring bookings or create a new one (admin only for write)."""

    permission_classes = [permissions.IsAuthenticated, IsAdminOrReadOnly]

    def get_serializer_class(self) -> type:
        if self.request.method == "POST":
            return RecurringBookingCreateUpdateSerializer
        return RecurringBookingSerializer

    def get_queryset(self) -> QuerySet[RecurringBooking]:
        queryset = RecurringBooking.objects.select_related("room", "created_by")

        # Filter by room
        room_id = self.request.query_params.get("room")
        if room_id:
            queryset = queryset.filter(room_id=room_id)

        # Filter by active status
        active_only = self.request.query_params.get("active")
        if active_only and active_only.lower() == "true":
            queryset = queryset.filter(is_active=True)

        return queryset


class RecurringBookingDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Retrieve, update, or delete a recurring booking (admin only for write)."""

    permission_classes = [permissions.IsAuthenticated, IsAdminOrReadOnly]
    queryset = RecurringBooking.objects.select_related("room", "created_by")

    def get_serializer_class(self) -> type:
        if self.request.method in ["PUT", "PATCH"]:
            return RecurringBookingCreateUpdateSerializer
        return RecurringBookingSerializer


class RecurringBookingExceptionView(APIView):
    """Create an exception for a recurring booking (skip a single occurrence)."""

    permission_classes = [permissions.IsAuthenticated, IsAdminOrReadOnly]

    def post(self, request: Request, pk: int) -> Response:
        """Create an exception for a specific date."""
        try:
            recurring_booking = RecurringBooking.objects.get(pk=pk)
        except RecurringBooking.DoesNotExist:
            return Response(
                {"error": "Recurring booking not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        exception_date = request.data.get("exception_date")
        if not exception_date:
            return Response(
                {"error": "exception_date is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate date format
        try:
            datetime.strptime(exception_date, "%Y-%m-%d")
        except (ValueError, TypeError):
            return Response(
                {"error": "Invalid date format. Use YYYY-MM-DD."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check if exception already exists
        exception, created = RecurringBookingException.objects.get_or_create(
            recurring_booking=recurring_booking,
            exception_date=exception_date,
        )

        if not created:
            return Response(
                {"message": "Exception already exists for this date"},
                status=status.HTTP_200_OK,
            )

        serializer = RecurringBookingExceptionSerializer(exception)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


# Calendar and utility views


class CalendarBookingsView(APIView):
    """
    Get bookings for calendar display.
    Returns unified list of one-time events (with rooms) and expanded recurring occurrences.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> Response:
        from apps.events.models import Event

        start_str = request.query_params.get("start")
        end_str = request.query_params.get("end")
        room_id = request.query_params.get("room")

        if not start_str or not end_str:
            return Response(
                {"error": "start and end parameters are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            start_date = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            end_date = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
        except ValueError:
            return Response(
                {"error": "Invalid date format"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Get one-time events with rooms
        events_query = (
            Event.objects.filter(
                rooms__isnull=False,
                start_datetime__lt=end_date,
                end_datetime__gt=start_date,
            )
            .select_related("created_by")
            .prefetch_related("rooms")
            .distinct()
        )

        if room_id:
            events_query = events_query.filter(rooms__id=room_id)

        # Produce one calendar entry per (event, room) pair so each room's
        # occupancy view shows the booking correctly.
        calendar_items = []
        for event in events_query:
            user_data = {
                "id": event.created_by.id,
                "first_name": event.created_by.first_name,
                "last_name": event.created_by.last_name,
                "profile_picture": event.created_by.avatar_url,
            }
            for room in event.rooms.all():
                calendar_items.append(
                    {
                        "id": f"{event.id}-r{room.id}",
                        "event_slug": event.slug,
                        "room": {
                            "id": room.id,
                            "name": room.name,
                            "color": room.color,
                        },
                        "user": user_data,
                        "title": event.title,
                        "description": event.description,
                        "start_datetime": event.start_datetime.isoformat(),
                        "end_datetime": event.end_datetime.isoformat(),
                        "is_recurring": False,
                        "recurring_booking_id": None,
                    }
                )

        # Get expanded recurring bookings
        room_id_int = int(room_id) if room_id else None
        recurring_items = expand_recurring_bookings_for_range(
            room_id_int, start_date.date(), end_date.date()
        )
        calendar_items.extend(recurring_items)

        # Sort by start datetime
        calendar_items.sort(key=lambda x: x["start_datetime"])

        # Serialize with context for is_own
        serializer = CalendarBookingSerializer(
            calendar_items, many=True, context={"request": request}
        )
        return Response(serializer.data)


class CheckAvailabilityView(APIView):
    """Check if rooms are available for a given time slot."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request) -> Response:
        serializer = AvailabilityCheckSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        result = check_multi_room_booking(
            room_ids=data["room_ids"],
            start=data["start_datetime"],
            end=data["end_datetime"],
            exclude_event_id=data.get("exclude_event_id"),
        )

        return Response(result)
