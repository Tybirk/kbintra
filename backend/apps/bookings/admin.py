"""
Admin configuration for Bookings app.
"""

from django.contrib import admin

from .models import RecurringBooking, RecurringBookingException, Room


@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ["name", "color", "is_active", "sort_order"]
    list_filter = ["is_active"]
    search_fields = ["name", "description"]
    ordering = ["sort_order", "name"]
    list_editable = ["sort_order", "is_active"]


@admin.register(RecurringBooking)
class RecurringBookingAdmin(admin.ModelAdmin):
    list_display = [
        "title",
        "room",
        "days_of_week_display",
        "start_time",
        "end_time",
        "effective_from",
        "effective_until",
        "is_active",
        "created_by",
    ]
    list_filter = ["room", "is_active"]
    search_fields = ["title", "description"]
    ordering = ["room", "start_time"]
    raw_id_fields = ["created_by"]
    list_editable = ["is_active"]


@admin.register(RecurringBookingException)
class RecurringBookingExceptionAdmin(admin.ModelAdmin):
    list_display = ["recurring_booking", "exception_date", "created_at"]
    list_filter = ["recurring_booking", "exception_date"]
    ordering = ["-exception_date"]
    raw_id_fields = ["recurring_booking"]
