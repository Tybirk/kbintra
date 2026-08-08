from django.contrib import admin

from .models import CarBlock, CarLoan, CarLoanCandidate


@admin.register(CarBlock)
class CarBlockAdmin(admin.ModelAdmin):
    list_display = ["car", "days_of_week_display", "start_time", "end_time"]
    list_filter = ["car__house"]
    search_fields = ["car__license_plate"]


class CarLoanCandidateInline(admin.TabularInline):
    model = CarLoanCandidate
    extra = 0
    readonly_fields = ["created_at"]


@admin.register(CarLoan)
class CarLoanAdmin(admin.ModelAdmin):
    list_display = [
        "id",
        "borrower",
        "status",
        "start_at",
        "end_at",
        "car",
        "actual_km",
        "amount_due",
    ]
    list_filter = ["status", "start_at"]
    search_fields = ["borrower__first_name", "borrower__last_name", "car__license_plate"]
    readonly_fields = ["created_at", "updated_at", "activated_at", "completed_at"]
    inlines = [CarLoanCandidateInline]


@admin.register(CarLoanCandidate)
class CarLoanCandidateAdmin(admin.ModelAdmin):
    list_display = ["id", "loan", "car", "status", "responded_by", "responded_at"]
    list_filter = ["status"]
