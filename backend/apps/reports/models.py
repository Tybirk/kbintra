"""
Models for the Indrapportering app — resident reports to an udvalg.

A resident reports something broken, faulty or wished-for to an udvalg that has
reporting switched on (``forum.Subgroup.reporting_enabled``). Every resident can
read the queue and comment; the udvalg's own members move a case through its
statuses. Each case carries a per-udvalg number so people can say "sag #14" and
mean one thing.

Replaces Driftsudvalgets standalone reporting PWA; the ``legacy_*`` fields carry
what that export could tell us about the cases imported from it.

Photos are ordinary community media: they live under MEDIA_ROOT and are served
through ``apps.backup.views.serve_media`` like any forum attachment. Unlike
expense receipts there is nothing private about a picture of a broken chair, so
none of the private-prefix machinery in ``apps.expenses`` applies here.
"""

from django.conf import settings
from django.db import models


class Report(models.Model):
    """A single case reported to an udvalg."""

    class Kind(models.TextChoices):
        DEFECT = "defect", "Defekt inventar"
        FAULTY = "faulty", "Fejlbehæftet inventar"
        SUGGESTION = "suggestion", "Forslag til nyt inventar"

    class Status(models.TextChoices):
        NEW = "new", "Ny"
        IN_PROGRESS = "in_progress", "I gang"
        AWAITING_MEETING = "awaiting_meeting", "Afventer udvalgsmøde"
        AWAITING_OTHER = "awaiting_other", "Afventer andet"
        DONE = "done", "Afsluttet"
        REJECTED = "rejected", "Afvist"

    # Statuses that mean the udvalg is done with the case (sets closed_at).
    CLOSED_STATUSES = (Status.DONE, Status.REJECTED)

    subgroup = models.ForeignKey(
        "forum.Subgroup",
        on_delete=models.CASCADE,
        related_name="reports",
        help_text="Udvalget sagen er indrapporteret til.",
    )
    number = models.PositiveIntegerField(
        help_text="Sagsnummer inden for udvalget — vises som #n.",
    )
    kind = models.CharField(max_length=20, choices=Kind.choices, db_index=True)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.NEW,
        db_index=True,
    )
    description = models.TextField(help_text="Hvad er der sket.")
    location = models.CharField(
        max_length=200,
        blank=True,
        help_text="Hvor det er, fx 'køkkenet i Hus 39'. Valgfri.",
    )
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="reports",
    )
    legacy_reporter_name = models.CharField(
        max_length=150,
        blank=True,
        help_text="Navn fra det gamle system, når indrapportøren ikke kunne matches til en bruger.",
    )
    legacy_url = models.CharField(
        max_length=300,
        blank=True,
        help_text="Sagens adresse i Driftsudvalgets tidligere system.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    closed_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Sat da sagen blev afsluttet eller afvist.",
    )

    class Meta:
        # Newest first, and deliberately NOT by `number`: the combined list spans
        # several udvalg, where each has its own counter — so #3 in one group
        # would interleave with #3 in another. Numbers are handed out in
        # chronological order anyway, so within one udvalg this is the same thing.
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["subgroup", "number"],
                name="unique_report_number_per_subgroup",
            ),
        ]

    def __str__(self) -> str:
        return f"#{self.number} {self.get_kind_display()} ({self.get_status_display()})"

    @property
    def reporter_name(self) -> str:
        """Display name for whoever reported this, user row or legacy text."""
        if self.submitted_by:
            return self.submitted_by.get_full_name() or self.submitted_by.email
        return self.legacy_reporter_name or "Ukendt"

    @property
    def is_open(self) -> bool:
        return self.status not in self.CLOSED_STATUSES


class ReportCounter(models.Model):
    """High-water mark for one udvalg's case numbers.

    Numbers must never be reused. People say "sag #31" out loud, and a
    notification link is addressed by number — so if #31 were handed to a new
    case after the original was deleted, an old link would silently open a
    different case. ``max(number) + 1`` does exactly that, which is why
    allocation reads a counter that only ever goes up.
    """

    subgroup = models.OneToOneField(
        "forum.Subgroup",
        on_delete=models.CASCADE,
        related_name="report_counter",
    )
    last_number = models.PositiveIntegerField(
        default=0,
        help_text="Højeste sagsnummer der har været brugt — også hvis sagen siden er slettet.",
    )

    def __str__(self) -> str:
        return f"{self.subgroup} @ #{self.last_number}"


class ReportPhoto(models.Model):
    """A photo attached to a report.

    "Et billede gør det langt lettere at handle hurtigt" — the reason the old
    app asked for one before anything else.
    """

    report = models.ForeignKey(
        Report,
        on_delete=models.CASCADE,
        related_name="photos",
    )
    image = models.ImageField(upload_to="report_photos/")
    thumbnail = models.ImageField(
        upload_to="report_photos/thumbs/",
        blank=True,
        null=True,
        help_text="400px-longest-edge JPEG thumbnail, generated in the background.",
    )
    name = models.CharField(max_length=255)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["uploaded_at"]

    def __str__(self) -> str:
        return f"{self.name} (#{self.report.number})"

    def delete(self, *args: object, **kwargs: object) -> tuple:
        """Remove both files from storage along with the row."""
        self.image.delete(save=False)
        if self.thumbnail:
            self.thumbnail.delete(save=False)
        return super().delete(*args, **kwargs)


class ReportEvent(models.Model):
    """One entry in a report's log — creation, a status change, or a comment.

    A status change carrying a note is a single event, not two: the udvalg's
    update form offers status and message together ("du kan skrive en besked
    uden at ændre status, eller kombinere begge").
    """

    class Kind(models.TextChoices):
        CREATED = "created", "Sag oprettet"
        STATUS = "status", "Statusændring"
        COMMENT = "comment", "Kommentar"

    report = models.ForeignKey(
        Report,
        on_delete=models.CASCADE,
        related_name="events",
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="report_events",
        help_text="Tom for systemgenererede hændelser.",
    )
    kind = models.CharField(max_length=20, choices=Kind.choices)
    old_status = models.CharField(max_length=20, blank=True)
    new_status = models.CharField(max_length=20, blank=True)
    message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"#{self.report_id} {self.kind} ({self.created_at:%Y-%m-%d})"
