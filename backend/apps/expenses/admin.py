from django.contrib import admin

from .models import Expense, ExpenseAttachment


class ExpenseAttachmentInline(admin.TabularInline):
    model = ExpenseAttachment
    extra = 0
    readonly_fields = ["uploaded_at"]


@admin.register(Expense)
class ExpenseAdmin(admin.ModelAdmin):
    list_display = ["submitted_by", "amount", "status", "food_related", "created_at", "paid_at"]
    list_filter = ["status", "food_related", "created_at"]
    search_fields = ["submitted_by__first_name", "submitted_by__last_name", "description"]
    readonly_fields = ["created_at", "updated_at"]
    inlines = [ExpenseAttachmentInline]
