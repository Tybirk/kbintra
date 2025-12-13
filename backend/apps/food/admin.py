"""
Admin configuration for Food models.
"""

from django.contrib import admin

from .models import (
    DailyMenu,
    FoodTicket,
    MealPreference,
    MealRegistration,
    MenuTemplate,
    WeeklyMenu,
)


@admin.register(MenuTemplate)
class MenuTemplateAdmin(admin.ModelAdmin):
    list_display = ["name", "has_meat_option", "created_at"]
    list_filter = ["has_meat_option"]
    search_fields = ["name", "description"]


class DailyMenuInline(admin.TabularInline):
    model = DailyMenu
    extra = 0
    fields = [
        "date",
        "day_of_week",
        "template",
        "description",
        "has_meat_option",
        "meat_description",
        "vegetarian_description",
    ]
    raw_id_fields = ["template"]


@admin.register(WeeklyMenu)
class WeeklyMenuAdmin(admin.ModelAdmin):
    list_display = ["week_start_date", "created_by", "created_at"]
    list_filter = ["week_start_date"]
    search_fields = ["created_by__email"]
    raw_id_fields = ["created_by"]
    inlines = [DailyMenuInline]


@admin.register(DailyMenu)
class DailyMenuAdmin(admin.ModelAdmin):
    list_display = ["date", "day_of_week", "template", "weekly_menu", "has_meat_option"]
    list_filter = ["day_of_week", "has_meat_option", "template"]
    search_fields = ["description", "template__name"]
    raw_id_fields = ["template"]
    date_hierarchy = "date"


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
