"""
Admin configuration for Food models.
"""

from django.contrib import admin

from .models import (
    DriveMenuCache,
    FoodTeam,
    FoodTeamCycle,
    FoodTeamMember,
    FoodTeamWish,
    FoodTicket,
    MealPreference,
    MealRegistration,
    TeamSwapRequest,
)


@admin.register(MealPreference)
class MealPreferenceAdmin(admin.ModelAdmin):
    list_display = ["user", "day_of_week", "adults_meat", "adults_veg", "children_count"]
    list_filter = ["day_of_week"]
    search_fields = ["user__email"]
    raw_id_fields = ["user"]


@admin.register(MealRegistration)
class MealRegistrationAdmin(admin.ModelAdmin):
    list_display = ["user", "date", "adults_meat", "adults_veg", "children_count", "is_active"]
    list_filter = ["date", "is_active"]
    search_fields = ["user__email"]
    raw_id_fields = ["user"]
    date_hierarchy = "date"


@admin.register(FoodTicket)
class FoodTicketAdmin(admin.ModelAdmin):
    list_display = [
        "owner",
        "date",
        "adults_meat",
        "adults_veg",
        "children_count",
        "price",
        "is_available",
        "claimed_by",
    ]
    list_filter = ["date", "is_available"]
    search_fields = ["owner__email", "claimed_by__email"]
    raw_id_fields = ["owner", "claimed_by"]
    date_hierarchy = "date"


@admin.register(DriveMenuCache)
class DriveMenuCacheAdmin(admin.ModelAdmin):
    list_display = ["week_number", "year", "fetched_at"]
    list_filter = ["year"]
    search_fields = ["monday_menu", "tuesday_menu", "wednesday_menu", "thursday_menu"]
    readonly_fields = ["fetched_at"]


@admin.register(FoodTeam)
class FoodTeamAdmin(admin.ModelAdmin):
    list_display = ["date", "cycle", "member_count", "created_at"]
    list_filter = ["cycle"]
    search_fields = ["notes"]
    date_hierarchy = "date"
    raw_id_fields = ["cycle"]


@admin.register(FoodTeamMember)
class FoodTeamMemberAdmin(admin.ModelAdmin):
    list_display = ["user", "team", "house_number", "created_at"]
    list_filter = ["team__date"]
    search_fields = ["user__email", "user__first_name", "house_number"]
    raw_id_fields = ["team", "user"]


@admin.register(FoodTeamCycle)
class FoodTeamCycleAdmin(admin.ModelAdmin):
    list_display = ["name", "status", "wish_deadline", "created_by", "created_at"]
    list_filter = ["status"]
    search_fields = ["name"]
    raw_id_fields = ["created_by"]
    readonly_fields = ["created_at", "updated_at"]


@admin.register(FoodTeamWish)
class FoodTeamWishAdmin(admin.ModelAdmin):
    list_display = ["user", "cycle", "available_date_count", "created_at"]
    list_filter = ["cycle"]
    search_fields = ["user__email", "user__first_name", "comment"]
    raw_id_fields = ["cycle", "user"]


@admin.register(TeamSwapRequest)
class TeamSwapRequestAdmin(admin.ModelAdmin):
    list_display = ["requester", "status", "created_at"]
    list_filter = ["status"]
    search_fields = ["requester__email", "message"]
    raw_id_fields = ["requester", "requester_membership", "target_membership"]
