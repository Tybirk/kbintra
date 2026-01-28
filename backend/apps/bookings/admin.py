"""
Admin configuration for Bookings app.
"""

from django.contrib import admin

from .models import Booking, RecurringBooking, Room


@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ["name", "capacity", "color", "is_active", "sort_order"]
    list_filter = ["is_active"]
    search_fields = ["name", "description"]
    ordering = ["sort_order", "name"]
    list_editable = ["sort_order", "is_active"]


@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    list_display = [
        "title",
        "room",
        "user",
        "start_datetime",
        "end_datetime",
        "duration_hours",
    ]
    list_filter = ["room", "start_datetime", "user"]
    search_fields = ["title", "description", "user__first_name", "user__last_name"]
    date_hierarchy = "start_datetime"
    ordering = ["-start_datetime"]
    raw_id_fields = ["user"]

    def duration_hours(self, obj: Booking) -> str:
        return f"{obj.duration_hours:.1f}h"

    duration_hours.short_description = "Varighed"


@admin.register(RecurringBooking)
class RecurringBookingAdmin(admin.ModelAdmin):
    list_display = [
        "title",
        "room",
        "day_of_week",
        "start_time",
        "end_time",
        "is_active",
        "created_by",
    ]
    list_filter = ["room", "day_of_week", "is_active"]
    search_fields = ["title", "description"]
    ordering = ["room", "day_of_week", "start_time"]
    raw_id_fields = ["created_by"]
    list_editable = ["is_active"]
