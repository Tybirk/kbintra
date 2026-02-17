"""
Admin configuration for Events app.
"""

from django.contrib import admin

from .models import Event, EventAttendance


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = [
        "title",
        "visibility",
        "start_datetime",
        "end_datetime",
        "room",
        "location",
        "created_by",
        "rsvp_enabled",
    ]
    list_filter = ["visibility", "rsvp_enabled", "room", "start_datetime"]
    search_fields = ["title", "description", "location"]
    date_hierarchy = "start_datetime"
    ordering = ["start_datetime"]
    raw_id_fields = ["created_by", "subgroup", "folder"]


@admin.register(EventAttendance)
class EventAttendanceAdmin(admin.ModelAdmin):
    list_display = ["event", "user", "child", "status", "responded_by", "updated_at"]
    list_filter = ["status", "event"]
    raw_id_fields = ["event", "user", "child", "responded_by"]
