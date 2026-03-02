"""
Models for Events app — unified model for community events and private room bookings.
"""

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils.text import slugify


class Event(models.Model):
    """Something happening at a time in a place — community event or private room booking."""

    class Visibility(models.TextChoices):
        COMMUNITY = "community", "Fællesskab"
        PRIVATE = "private", "Privat"

    # Core
    title = models.CharField(max_length=255)
    slug = models.SlugField(max_length=255, unique=True, blank=True, allow_unicode=True)
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

    # Location — rooms M2M, free text, or both
    rooms = models.ManyToManyField(
        "bookings.Room",
        blank=True,
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
    thread = models.OneToOneField(
        "forum.Thread",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="event",
    )

    # RSVP settings
    rsvp_enabled = models.BooleanField(default=False)
    rsvp_deadline = models.DateTimeField(null=True, blank=True)

    # Cancellation
    is_cancelled = models.BooleanField(default=False)
    cancellation_message = models.TextField(blank=True, default="")

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["start_datetime"]
        indexes = [
            models.Index(fields=["visibility", "start_datetime"]),
        ]

    def save(self, *args: object, **kwargs: object) -> None:
        if not self.slug:
            self.slug = self._generate_slug()
        super().save(*args, **kwargs)

    def _generate_slug(self) -> str:
        base = slugify(self.title, allow_unicode=True) or "arrangement"
        slug = base
        n = 2
        while Event.objects.filter(slug=slug).exclude(pk=self.pk).exists():
            slug = f"{base}-{n}"
            n += 1
        return slug

    def __str__(self) -> str:
        return f"{self.title} ({self.start_datetime.date()})"

    @property
    def resolved_location(self) -> str:
        parts = [r.name for r in self.rooms.all()]
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


class EventReminderLog(models.Model):
    """Records reminders that have been sent for an event.

    Used by the periodic reminder task to ensure each reminder type
    (24h, 1h) is sent at most once per event, even if the task runs
    multiple times within the same window.
    """

    class ReminderType(models.TextChoices):
        H24 = "24h", "24 timer før"
        H1 = "1h", "1 time før"

    event = models.ForeignKey(
        Event,
        on_delete=models.CASCADE,
        related_name="reminder_logs",
    )
    reminder_type = models.CharField(max_length=10, choices=ReminderType.choices)
    sent_at = models.DateTimeField(auto_now_add=True)
    recipients_count = models.IntegerField(default=0)

    class Meta:
        unique_together = [("event", "reminder_type")]

    def __str__(self) -> str:
        return f"{self.event.title} – {self.reminder_type} reminder"
