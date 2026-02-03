"""
Tests for Bookings app.
"""

import datetime

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from .models import Booking, RecurringBooking, RecurringBookingException, Room
from .validators import check_booking_overlaps

User = get_user_model()


class RoomModelTest(TestCase):
    """Tests for Room model."""

    def test_room_creation(self):
        """Test that a room can be created."""
        room = Room.objects.create(
            name="Meeting Room",
            description="A meeting room",
            color="#FF0000",
        )
        self.assertEqual(room.name, "Meeting Room")
        self.assertEqual(str(room), "Meeting Room")


class BookingModelTest(TestCase):
    """Tests for Booking model."""

    def setUp(self):
        self.user = User.objects.create_user(
            email="test@example.com",
            password="testpass123",
            first_name="Test",
            last_name="User",
        )
        self.room = Room.objects.create(name="Test Room")

    def test_booking_creation(self):
        """Test that a booking can be created."""
        start = timezone.now() + datetime.timedelta(hours=1)
        end = start + datetime.timedelta(hours=2)
        booking = Booking.objects.create(
            room=self.room,
            user=self.user,
            title="Test Booking",
            start_datetime=start,
            end_datetime=end,
        )
        self.assertEqual(booking.title, "Test Booking")
        self.assertAlmostEqual(booking.duration_hours, 2.0, places=1)


class OverlapValidatorTest(TestCase):
    """Tests for booking overlap validation."""

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
        self.existing_booking = Booking.objects.create(
            room=self.room,
            user=self.user,
            title="Existing Booking",
            start_datetime=self.start,
            end_datetime=self.end,
        )

    def test_no_overlap(self):
        """Test that non-overlapping bookings are allowed."""
        new_start = self.end + datetime.timedelta(hours=1)
        new_end = new_start + datetime.timedelta(hours=1)
        result = check_booking_overlaps(self.room.id, new_start, new_end)
        self.assertFalse(result["has_conflict"])

    def test_overlap_detected(self):
        """Test that overlapping bookings are detected."""
        new_start = self.start + datetime.timedelta(minutes=30)
        new_end = new_start + datetime.timedelta(hours=1)
        result = check_booking_overlaps(self.room.id, new_start, new_end)
        self.assertTrue(result["has_conflict"])
        self.assertEqual(len(result["conflicts"]), 1)

    def test_exclude_booking_id(self):
        """Test that a booking can be excluded from overlap check."""
        result = check_booking_overlaps(self.room.id, self.start, self.end, exclude_booking_id=None)
        self.assertTrue(result["has_conflict"])
        result = check_booking_overlaps(
            self.room.id, self.start, self.end, exclude_booking_id=self.existing_booking.id
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
        """Test that recurring booking is active on Monday."""
        today = datetime.date.today()
        days_ahead = 0 - today.weekday()
        if days_ahead <= 0:
            days_ahead += 7
        next_monday = today + datetime.timedelta(days=days_ahead)
        self.assertTrue(self.recurring.is_active_on_date(next_monday))

    def test_is_active_on_date_tuesday(self):
        """Test that recurring booking is not active on Tuesday."""
        today = datetime.date.today()
        days_ahead = 1 - today.weekday()
        if days_ahead <= 0:
            days_ahead += 7
        next_tuesday = today + datetime.timedelta(days=days_ahead)
        self.assertFalse(self.recurring.is_active_on_date(next_tuesday))

    def test_exception_skips_date(self):
        """Test that an exception date is skipped."""
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


class BookingAPITest(TestCase):
    """Tests for Booking API endpoints."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            email="test@example.com",
            password="testpass123",
            first_name="Test",
            last_name="User",
        )
        self.room = Room.objects.create(name="Test Room")
        self.client.force_authenticate(user=self.user)

    def test_create_booking(self):
        """Test creating a booking via API."""
        start = timezone.now() + datetime.timedelta(days=1)
        end = start + datetime.timedelta(hours=2)
        data = {
            "room_id": self.room.id,
            "title": "Test Booking",
            "description": "Test description",
            "start_datetime": start.isoformat(),
            "end_datetime": end.isoformat(),
        }
        response = self.client.post("/api/bookings/", data, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Booking.objects.count(), 1)

    def test_create_booking_overlap_rejected(self):
        """Test that overlapping booking is rejected."""
        start = timezone.now() + datetime.timedelta(days=1)
        end = start + datetime.timedelta(hours=2)
        Booking.objects.create(
            room=self.room,
            user=self.user,
            title="First Booking",
            start_datetime=start,
            end_datetime=end,
        )
        data = {
            "room_id": self.room.id,
            "title": "Second Booking",
            "start_datetime": start.isoformat(),
            "end_datetime": end.isoformat(),
        }
        response = self.client.post("/api/bookings/", data, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Booking.objects.count(), 1)


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
        """Test creating an exception for a recurring booking."""
        response = self.client.post(
            f"/api/bookings/recurring/{self.recurring.id}/exception/",
            {"exception_date": "2026-01-06"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(RecurringBookingException.objects.count(), 1)

    def test_create_exception_invalid_date(self):
        """Test that invalid date format is rejected."""
        response = self.client.post(
            f"/api/bookings/recurring/{self.recurring.id}/exception/",
            {"exception_date": "invalid-date"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
