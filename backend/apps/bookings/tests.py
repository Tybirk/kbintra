"""
Tests for Bookings app.
"""

import datetime

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.events.models import Event

from .models import RecurringBooking, RecurringBookingException, Room
from .validators import check_booking_overlaps

User = get_user_model()


class RoomModelTest(TestCase):
    """Tests for Room model."""

    def test_room_creation(self):
        room = Room.objects.create(
            name="Meeting Room",
            description="A meeting room",
            color="#FF0000",
        )
        self.assertEqual(room.name, "Meeting Room")
        self.assertEqual(str(room), "Meeting Room")


class OverlapValidatorTest(TestCase):
    """Tests for booking overlap validation (now using Event model)."""

    def setUp(self):
        self.user = User.objects.create_user(
            email="test@example.com",
            password="testpass123",
            first_name="Test",
            last_name="User",
        )
        self.room = Room.objects.create(name="Test Room")
        self.start = timezone.now() + datetime.timedelta(days=1)
        self.end = self.start + datetime.timedelta(hours=2)
        self.existing_event = Event.objects.create(
            created_by=self.user,
            title="Existing Booking",
            visibility=Event.Visibility.PRIVATE,
            start_datetime=self.start,
            end_datetime=self.end,
        )
        self.existing_event.rooms.add(self.room)

    def test_no_overlap(self):
        new_start = self.end + datetime.timedelta(hours=1)
        new_end = new_start + datetime.timedelta(hours=1)
        result = check_booking_overlaps(self.room.id, new_start, new_end)
        self.assertFalse(result["has_conflict"])

    def test_overlap_detected(self):
        new_start = self.start + datetime.timedelta(minutes=30)
        new_end = new_start + datetime.timedelta(hours=1)
        result = check_booking_overlaps(self.room.id, new_start, new_end)
        self.assertTrue(result["has_conflict"])
        self.assertEqual(len(result["conflicts"]), 1)

    def test_exclude_event_id(self):
        result = check_booking_overlaps(self.room.id, self.start, self.end, exclude_event_id=None)
        self.assertTrue(result["has_conflict"])
        result = check_booking_overlaps(
            self.room.id, self.start, self.end, exclude_event_id=self.existing_event.id
        )
        self.assertFalse(result["has_conflict"])


class RecurringBookingTest(TestCase):
    """Tests for recurring booking functionality."""

    def setUp(self):
        self.user = User.objects.create_user(
            email="test@example.com",
            password="testpass123",
            first_name="Test",
            last_name="User",
        )
        self.room = Room.objects.create(name="Test Room")
        self.recurring = RecurringBooking.objects.create(
            room=self.room,
            created_by=self.user,
            title="Weekly Meeting",
            days_of_week=[0, 2, 4],
            start_time=datetime.time(9, 0),
            end_time=datetime.time(10, 0),
            is_active=True,
        )

    def test_is_active_on_date_monday(self):
        today = datetime.date.today()
        days_ahead = 0 - today.weekday()
        if days_ahead <= 0:
            days_ahead += 7
        next_monday = today + datetime.timedelta(days=days_ahead)
        self.assertTrue(self.recurring.is_active_on_date(next_monday))

    def test_is_active_on_date_tuesday(self):
        today = datetime.date.today()
        days_ahead = 1 - today.weekday()
        if days_ahead <= 0:
            days_ahead += 7
        next_tuesday = today + datetime.timedelta(days=days_ahead)
        self.assertFalse(self.recurring.is_active_on_date(next_tuesday))

    def test_exception_skips_date(self):
        today = datetime.date.today()
        days_ahead = 0 - today.weekday()
        if days_ahead <= 0:
            days_ahead += 7
        next_monday = today + datetime.timedelta(days=days_ahead)
        RecurringBookingException.objects.create(
            recurring_booking=self.recurring,
            exception_date=next_monday,
        )
        self.assertFalse(self.recurring.is_active_on_date(next_monday))


class CalendarExpansionQueryCountTest(TestCase):
    """Regression: expanding recurring bookings over a date range must not run a
    query per (booking, date) for exceptions (was an N+1)."""

    def setUp(self):
        self.user = User.objects.create_user(
            email="expand@example.com", password="x", first_name="E", last_name="X"
        )
        self.room = Room.objects.create(name="Expand Room")
        today = datetime.date.today()
        for i in range(5):
            rb = RecurringBooking.objects.create(
                room=self.room,
                created_by=self.user,
                title=f"RB{i}",
                days_of_week=[0, 1, 2, 3, 4, 5, 6],
                start_time=datetime.time(10, 0),
                end_time=datetime.time(11, 0),
                is_active=True,
            )
            # Exercise the exception path: skip one occurrence per booking.
            RecurringBookingException.objects.create(
                recurring_booking=rb, exception_date=today + datetime.timedelta(days=i)
            )

    def test_expansion_query_count_is_constant(self):
        from .validators import expand_recurring_bookings_for_range

        start = datetime.date.today()
        end = start + datetime.timedelta(days=30)
        # 2 queries total: one for the recurring bookings, one for all exceptions —
        # independent of the 5 bookings × 31 days being expanded.
        with self.assertNumQueries(2):
            expand_recurring_bookings_for_range(self.room.id, start, end)


class RecurringBookingExceptionAPITest(TestCase):
    """Tests for RecurringBookingException API."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            email="admin@example.com",
            password="testpass123",
            first_name="Admin",
            last_name="User",
            is_staff=True,
        )
        self.room = Room.objects.create(name="Test Room")
        self.recurring = RecurringBooking.objects.create(
            room=self.room,
            created_by=self.user,
            title="Weekly Meeting",
            days_of_week=[0, 2, 4],
            start_time=datetime.time(9, 0),
            end_time=datetime.time(10, 0),
            is_active=True,
        )
        self.client.force_authenticate(user=self.user)

    def test_create_exception(self):
        response = self.client.post(
            f"/api/bookings/recurring/{self.recurring.id}/exception/",
            {"exception_date": "2026-01-06"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(RecurringBookingException.objects.count(), 1)

    def test_create_exception_invalid_date(self):
        response = self.client.post(
            f"/api/bookings/recurring/{self.recurring.id}/exception/",
            {"exception_date": "invalid-date"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
