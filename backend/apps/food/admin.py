"""
Admin configuration for Food models.
"""

from django.contrib import admin
from django.utils import timezone

from .models import (
    ClosedFoodDay,
    DriveMenuCache,
    FoodTeam,
    FoodTeamCycle,
    FoodTeamMember,
    FoodTeamWish,
    FoodTicket,
    MealPreference,
    MealPrice,
    MealRegistration,
    SwapBroadcast,
    TeamFavour,
    TeamSwapRequest,
)


@admin.register(MealPreference)
class MealPreferenceAdmin(admin.ModelAdmin):
    list_display = ["house", "day_of_week", "adults_meat", "adults_veg", "children_count"]
    list_filter = ["day_of_week"]
    search_fields = ["house__name"]
    raw_id_fields = ["house", "last_modified_by"]


@admin.register(MealRegistration)
class MealRegistrationAdmin(admin.ModelAdmin):
    list_display = [
        "house",
        "date",
        "adults_meat",
        "adults_veg",
        "children_count",
        "is_active",
        "last_modified_by",
    ]
    list_filter = ["date", "is_active"]
    search_fields = ["house__name", "last_modified_by__email"]
    raw_id_fields = ["house", "last_modified_by"]
    date_hierarchy = "date"


@admin.register(FoodTicket)
class FoodTicketAdmin(admin.ModelAdmin):
    list_display = [
        "house",
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
    search_fields = ["house__name", "owner__email", "claimed_by__email"]
    raw_id_fields = ["house", "owner", "claimed_by"]
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
    search_fields = ["user__email", "user__first_name"]
    raw_id_fields = ["cycle", "user"]


@admin.register(TeamSwapRequest)
class TeamSwapRequestAdmin(admin.ModelAdmin):
    list_display = ["requester", "status", "created_at"]
    list_filter = ["status"]
    search_fields = ["requester__email", "message"]
    raw_id_fields = ["requester", "requester_membership", "target_membership"]


@admin.register(TeamFavour)
class TeamFavourAdmin(admin.ModelAdmin):
    list_display = ["creditor", "debtor", "origin_date", "settled", "created_at"]
    list_filter = ["settled", "cycle"]
    search_fields = ["creditor__first_name", "debtor__first_name"]
    raw_id_fields = ["creditor", "debtor", "cycle"]
    date_hierarchy = "origin_date"


@admin.register(SwapBroadcast)
class SwapBroadcastAdmin(admin.ModelAdmin):
    list_display = ["requester", "status", "created_at"]
    list_filter = ["status"]
    search_fields = ["requester__first_name", "message"]
    raw_id_fields = ["requester", "requester_membership", "accepted_by", "accepted_membership"]


@admin.register(ClosedFoodDay)
class ClosedFoodDayAdmin(admin.ModelAdmin):
    list_display = ["date", "reason", "created_by", "created_at"]
    list_filter = ["date"]
    search_fields = ["reason"]
    date_hierarchy = "date"
    raw_id_fields = ["created_by"]


@admin.register(MealPrice)
class MealPriceAdmin(admin.ModelAdmin):
    """Price sets already in effect are read-only — editing them rewrites past billing.

    Same rule as the API (`MealPriceSerializer` / `MealPriceDetailView`); enforced
    here too so the admin cannot bypass it.
    """

    list_display = [
        "effective_from",
        "price_adult_meat",
        "price_adult_veg",
        "price_child",
        "note",
        "created_by",
    ]
    search_fields = ["note"]
    date_hierarchy = "effective_from"
    raw_id_fields = ["created_by"]

    @staticmethod
    def _is_in_effect(obj: MealPrice | None) -> bool:
        return obj is not None and obj.effective_from < timezone.localdate()

    def has_change_permission(self, request, obj=None) -> bool:  # type: ignore[no-untyped-def]
        if self._is_in_effect(obj):
            return False
        return super().has_change_permission(request, obj)

    def has_delete_permission(self, request, obj=None) -> bool:  # type: ignore[no-untyped-def]
        if self._is_in_effect(obj):
            return False
        return super().has_delete_permission(request, obj)
