"""
Admin configuration for Announcements models.
"""

from django.contrib import admin

from .models import Announcement, AnnouncementAttachment


@admin.register(Announcement)
class AnnouncementAdmin(admin.ModelAdmin):
    list_display = ["title", "author", "is_active", "priority", "created_at"]
    list_filter = ["is_active", "created_at"]
    search_fields = ["title", "content", "author__email"]
    raw_id_fields = ["author"]
    date_hierarchy = "created_at"
    ordering = ["-priority", "-created_at"]


@admin.register(AnnouncementAttachment)
class AnnouncementAttachmentAdmin(admin.ModelAdmin):
    """Admin for AnnouncementAttachment model."""

    list_display = ["name", "announcement", "uploaded_by", "uploaded_at"]
    list_filter = ["uploaded_at"]
    search_fields = ["name", "announcement__title"]
    raw_id_fields = ["announcement", "uploaded_by"]
    date_hierarchy = "uploaded_at"
