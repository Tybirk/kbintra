"""
Admin configuration for Calendar app.
"""

from django.contrib import admin

from .models import Event


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = [
        "title",
        "start_datetime",
        "end_datetime",
        "location",
        "created_by",
        "is_all_day",
    ]
    list_filter = ["is_all_day", "start_datetime", "created_by"]
    search_fields = ["title", "description", "location"]
    date_hierarchy = "start_datetime"
    ordering = ["start_datetime"]
    raw_id_fields = ["created_by"]
