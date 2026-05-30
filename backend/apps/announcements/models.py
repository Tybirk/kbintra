"""
Models for Announcements app.
"""

from django.conf import settings
from django.db import models


class Announcement(models.Model):
    """Important announcements for the community."""

    title = models.CharField(max_length=255)
    content = models.TextField()
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="announcements",
    )
    edited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="edited_announcements",
    )
    is_active = models.BooleanField(default=True)
    show_on_dashboard = models.BooleanField(
        default=True,
        help_text="Show this announcement on the main dashboard page",
    )
    priority = models.IntegerField(
        default=0,
        help_text="Higher priority announcements appear first",
    )
    legacy_url = models.CharField(max_length=500, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-priority", "-created_at"]

    def __str__(self) -> str:
        return self.title


class AnnouncementAttachment(models.Model):
    """A file attachment for an announcement."""

    announcement = models.ForeignKey(
        Announcement,
        on_delete=models.CASCADE,
        related_name="attachments",
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="announcement_attachments",
    )
    file = models.FileField(upload_to="announcement_attachments/")
    name = models.CharField(max_length=255)
    preview_html = models.TextField(blank=True, default="")
    legacy_url = models.CharField(max_length=500, blank=True, null=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["uploaded_at"]

    def __str__(self) -> str:
        return f"{self.name} on {self.announcement}"

    def delete(self, *args: object, **kwargs: object) -> tuple:
        """Delete the file from storage when the attachment is deleted."""
        self.file.delete(save=False)
        return super().delete(*args, **kwargs)
