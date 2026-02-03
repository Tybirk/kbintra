"""
Models for Bookings app.
"""

import datetime

from django.conf import settings
from django.db import models


class Room(models.Model):
    """A bookable room or building."""

    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    image = models.ImageField(upload_to="rooms/", blank=True, null=True)
    color = models.CharField(max_length=7, default="#3B82F6", help_text="Hex color for calendar")
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "name"]

    def __str__(self) -> str:
        return self.name


class Booking(models.Model):
    """A room booking by a user."""

    MAX_DURATION_HOURS = 30

    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="bookings")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="bookings",
    )
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    start_datetime = models.DateTimeField()
    end_datetime = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["start_datetime"]
        indexes = [
            models.Index(fields=["room", "start_datetime", "end_datetime"]),
        ]

    def __str__(self) -> str:
        return f"{self.title} - {self.room.name} ({self.start_datetime})"

    @property
    def duration_hours(self) -> float:
        """Return booking duration in hours."""
        delta = self.end_datetime - self.start_datetime
        return delta.total_seconds() / 3600


class RecurringBooking(models.Model):
    """A recurring reservation (admin only)."""

    class DayOfWeek(models.IntegerChoices):
        MONDAY = 0, "Mandag"
        TUESDAY = 1, "Tirsdag"
        WEDNESDAY = 2, "Onsdag"
        THURSDAY = 3, "Torsdag"
        FRIDAY = 4, "Fredag"
        SATURDAY = 5, "Lørdag"
        SUNDAY = 6, "Søndag"

    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="recurring_bookings")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="created_recurring_bookings",
    )
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    # Support multiple days - stored as JSON list of integers [0, 1, 2, 3] for Mon-Thu
    days_of_week = models.JSONField(
        default=list, help_text="List of day integers (0=Monday, 6=Sunday)"
    )
    start_time = models.TimeField()
    end_time = models.TimeField()
    effective_from = models.DateField(null=True, blank=True)
    effective_until = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["room", "start_time"]

    def __str__(self) -> str:
        days = ", ".join(self.DayOfWeek(d).label for d in self.days_of_week)
        return f"{self.title} - {self.room.name} ({days})"

    @property
    def days_of_week_display(self) -> str:
        """Return human-readable day names."""
        return ", ".join(self.DayOfWeek(d).label for d in sorted(self.days_of_week))

    def is_active_on_date(self, date: "datetime.date") -> bool:
        """Check if this recurring booking is active on a given date."""
        if not self.is_active:
            return False
        if self.effective_from and date < self.effective_from:
            return False
        if self.effective_until and date > self.effective_until:
            return False
        # Check if date has an exception
        if self.exceptions.filter(exception_date=date).exists():
            return False
        return date.weekday() in self.days_of_week


class RecurringBookingException(models.Model):
    """Tracks single occurrence deletions for recurring bookings."""

    recurring_booking = models.ForeignKey(
        RecurringBooking,
        on_delete=models.CASCADE,
        related_name="exceptions",
    )
    exception_date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ["recurring_booking", "exception_date"]
        ordering = ["exception_date"]

    def __str__(self) -> str:
        return f"Exception for {self.recurring_booking.title} on {self.exception_date}"
