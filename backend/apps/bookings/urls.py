"""
URL configuration for bookings endpoints.
"""

from django.urls import path

from .views import (
    BookingDetailView,
    BookingListCreateView,
    CalendarBookingsView,
    CheckAvailabilityView,
    MyBookingsView,
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
    # Bookings
    path("", BookingListCreateView.as_view(), name="booking-list-create"),
    path("<int:pk>/", BookingDetailView.as_view(), name="booking-detail"),
    path("my/", MyBookingsView.as_view(), name="my-bookings"),
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
