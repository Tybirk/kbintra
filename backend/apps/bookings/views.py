"""
Views for Bookings app.
"""

from datetime import datetime
from typing import Any

from django.db.models import QuerySet
from rest_framework import generics, permissions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Booking, RecurringBooking, RecurringBookingException, Room
from .serializers import (
    AvailabilityCheckSerializer,
    BookingCreateUpdateSerializer,
    BookingSerializer,
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


class IsOwnerOrReadOnly(permissions.BasePermission):
    """Allow owners to edit/delete their own objects."""

    def has_object_permission(self, request: Request, view: Any, obj: Booking) -> bool:
        if request.method in permissions.SAFE_METHODS:
            return True
        return obj.user == request.user


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


# Booking views


class BookingListCreateView(generics.ListCreateAPIView):
    """List bookings or create a new one."""

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self) -> type:
        if self.request.method == "POST":
            return BookingCreateUpdateSerializer
        return BookingSerializer

    def get_queryset(self) -> QuerySet[Booking]:
        queryset = Booking.objects.select_related("room", "user")

        # Filter by room
        room_id = self.request.query_params.get("room")
        if room_id:
            queryset = queryset.filter(room_id=room_id)

        # Filter by date range
        start = self.request.query_params.get("start")
        end = self.request.query_params.get("end")

        if start:
            try:
                start_date = datetime.fromisoformat(start.replace("Z", "+00:00"))
                queryset = queryset.filter(end_datetime__gt=start_date)
            except ValueError:
                pass

        if end:
            try:
                end_date = datetime.fromisoformat(end.replace("Z", "+00:00"))
                queryset = queryset.filter(start_datetime__lt=end_date)
            except ValueError:
                pass

        return queryset


class BookingDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Retrieve, update, or delete a booking."""

    permission_classes = [permissions.IsAuthenticated, IsOwnerOrReadOnly]
    queryset = Booking.objects.select_related("room", "user")

    def get_serializer_class(self) -> type:
        if self.request.method in ["PUT", "PATCH"]:
            return BookingCreateUpdateSerializer
        return BookingSerializer


class MyBookingsView(generics.ListAPIView):
    """List current user's bookings."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = BookingSerializer

    def get_queryset(self) -> QuerySet[Booking]:
        return Booking.objects.filter(user=self.request.user).select_related("room", "user")


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
    Returns unified list of one-time bookings and expanded recurring occurrences.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> Response:
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

        # Get one-time bookings
        bookings_query = Booking.objects.filter(
            start_datetime__lt=end_date,
            end_datetime__gt=start_date,
        ).select_related("room", "user")

        if room_id:
            bookings_query = bookings_query.filter(room_id=room_id)

        # Convert to list of dicts
        calendar_items = []
        for booking in bookings_query:
            calendar_items.append(
                {
                    "id": str(booking.id),
                    "room": {
                        "id": booking.room.id,
                        "name": booking.room.name,
                        "color": booking.room.color,
                    },
                    "user": {
                        "id": booking.user.id,
                        "first_name": booking.user.first_name,
                        "last_name": booking.user.last_name,
                        "profile_picture": (
                            booking.user.profile_picture.url
                            if booking.user.profile_picture
                            else None
                        ),
                    },
                    "title": booking.title,
                    "description": booking.description,
                    "start_datetime": booking.start_datetime.isoformat(),
                    "end_datetime": booking.end_datetime.isoformat(),
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
            exclude_booking_id=data.get("exclude_booking_id"),
        )

        return Response(result)
