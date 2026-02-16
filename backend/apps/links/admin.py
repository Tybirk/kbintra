from django.contrib import admin

from .models import UsefulLinks


@admin.register(UsefulLinks)
class UsefulLinksAdmin(admin.ModelAdmin):
    list_display = ["updated_at", "updated_by"]
