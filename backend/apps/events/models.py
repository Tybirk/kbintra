"""
Models for Events app — unified model for community events and private room bookings.
"""

from django.conf import settings
from django.db import models
from django.db.models import Q


class Event(models.Model):
    """Something happening at a time in a place — community event or private room booking."""

    class Visibility(models.TextChoices):
        COMMUNITY = "community", "Fællesskab"
        PRIVATE = "private", "Privat"

    # Core
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="created_events",
    )
    visibility = models.CharField(
        max_length=20,
        choices=Visibility.choices,
        default=Visibility.COMMUNITY,
    )

    # Time
    start_datetime = models.DateTimeField()
    end_datetime = models.DateTimeField()
    is_all_day = models.BooleanField(default=False)

    # Location — room FK, free text, or both
    room = models.ForeignKey(
        "bookings.Room",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="events",
    )
    location = models.CharField(max_length=255, blank=True)

    # Forum integration (all optional)
    subgroup = models.ForeignKey(
        "forum.Subgroup",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="events",
    )
    folder = models.ForeignKey(
        "forum.Folder",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="events",
    )

    # RSVP settings
    rsvp_enabled = models.BooleanField(default=False)
    rsvp_deadline = models.DateTimeField(null=True, blank=True)

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["start_datetime"]
        indexes = [
            models.Index(fields=["room", "start_datetime", "end_datetime"]),
            models.Index(fields=["visibility", "start_datetime"]),
        ]

    def __str__(self) -> str:
        return f"{self.title} ({self.start_datetime.date()})"

    @property
    def resolved_location(self) -> str:
        parts = []
        if self.room:
            parts.append(self.room.name)
        if self.location:
            parts.append(self.location)
        return ", ".join(parts)


class EventAttendance(models.Model):
    """RSVP response for one person (user or child) on one event."""

    class Status(models.TextChoices):
        ATTENDING = "attending", "Deltager"
        NOT_ATTENDING = "not_attending", "Deltager ikke"
        NOT_ANSWERED = "not_answered", "Ikke svaret"

    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="attendances")
    responded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="rsvp_responses",
    )

    # Exactly one of these is set:
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="event_attendances",
    )
    child = models.ForeignKey(
        "houses.Child",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="event_attendances",
    )

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.NOT_ANSWERED,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["event", "user"],
                condition=Q(user__isnull=False),
                name="unique_event_user",
            ),
            models.UniqueConstraint(
                fields=["event", "child"],
                condition=Q(child__isnull=False),
                name="unique_event_child",
            ),
            models.CheckConstraint(
                condition=(
                    Q(user__isnull=False, child__isnull=True)
                    | Q(user__isnull=True, child__isnull=False)
                ),
                name="exactly_one_attendee",
            ),
        ]

    def __str__(self) -> str:
        person = self.user or self.child
        return f"{person} → {self.event.title}: {self.get_status_display()}"
