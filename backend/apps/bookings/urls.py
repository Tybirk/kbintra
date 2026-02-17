"""
URL configuration for bookings endpoints.
"""

from django.urls import path

from .views import (
    CalendarBookingsView,
    CheckAvailabilityView,
    RecurringBookingDetailView,
    RecurringBookingExceptionView,
    RecurringBookingListCreateView,
    RoomDetailView,
    RoomListCreateView,
)

urlpatterns = [
    # Rooms
    path("rooms/", RoomListCreateView.as_view(), name="room-list-create"),
    path("rooms/<int:pk>/", RoomDetailView.as_view(), name="room-detail"),
    # Recurring bookings
    path("recurring/", RecurringBookingListCreateView.as_view(), name="recurring-list-create"),
    path("recurring/<int:pk>/", RecurringBookingDetailView.as_view(), name="recurring-detail"),
    path(
        "recurring/<int:pk>/exception/",
        RecurringBookingExceptionView.as_view(),
        name="recurring-exception",
    ),
    # Calendar and utility
    path("calendar/", CalendarBookingsView.as_view(), name="calendar-bookings"),
    path("check-availability/", CheckAvailabilityView.as_view(), name="check-availability"),
]
