"""
Admin configuration for House models.
"""

from django.contrib import admin

from .models import House


@admin.register(House)
class HouseAdmin(admin.ModelAdmin):
    """Admin configuration for House model."""

    list_display = ("name", "address", "inhabitant_count", "created_at")
    search_fields = ("name", "address")
    ordering = ("name",)

    @admin.display(description="Inhabitants")
    def inhabitant_count(self, obj: House) -> int:
        """Display number of inhabitants in the house."""
        return obj.inhabitants.count()
