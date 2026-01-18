"""
Admin configuration for Food models.
"""

from django.contrib import admin

from .models import (
    DriveMenuCache,
    FoodTicket,
    MealPreference,
    MealRegistration,
)


@admin.register(MealPreference)
class MealPreferenceAdmin(admin.ModelAdmin):
    list_display = ["user", "day_of_week", "adults_count", "children_count", "prefers_meat"]
    list_filter = ["day_of_week", "prefers_meat"]
    search_fields = ["user__email"]
    raw_id_fields = ["user"]


@admin.register(MealRegistration)
class MealRegistrationAdmin(admin.ModelAdmin):
    list_display = ["user", "date", "adults_count", "children_count", "meal_type", "is_active"]
    list_filter = ["date", "meal_type", "is_active"]
    search_fields = ["user__email"]
    raw_id_fields = ["user"]
    date_hierarchy = "date"


@admin.register(FoodTicket)
class FoodTicketAdmin(admin.ModelAdmin):
    list_display = [
        "owner",
        "date",
        "adults_count",
        "children_count",
        "price",
        "is_available",
        "claimed_by",
    ]
    list_filter = ["date", "is_available", "meal_type"]
    search_fields = ["owner__email", "claimed_by__email"]
    raw_id_fields = ["owner", "claimed_by"]
    date_hierarchy = "date"


@admin.register(DriveMenuCache)
class DriveMenuCacheAdmin(admin.ModelAdmin):
    list_display = ["week_number", "year", "fetched_at"]
    list_filter = ["year"]
    search_fields = ["monday_menu", "tuesday_menu", "wednesday_menu", "thursday_menu"]
    readonly_fields = ["fetched_at"]
