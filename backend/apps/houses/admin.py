"""
Admin configuration for House models.
"""

from django.contrib import admin

from .models import Car, Child, House


class ChildInline(admin.TabularInline):
    """Inline admin for children in a house."""

    model = Child
    extra = 0
    fields = ("name", "birthdate")


class CarInline(admin.TabularInline):
    """Inline admin for cars in a house."""

    model = Car
    extra = 0
    fields = ("license_plate", "is_electric")


@admin.register(House)
class HouseAdmin(admin.ModelAdmin):
    """Admin configuration for House model."""

    list_display = (
        "name",
        "address",
        "inhabitant_count",
        "children_count",
        "car_count",
        "created_at",
    )
    search_fields = ("name", "address")
    ordering = ("name",)
    inlines = [ChildInline, CarInline]

    @admin.display(description="Inhabitants")
    def inhabitant_count(self, obj: House) -> int:
        """Display number of inhabitants in the house."""
        return obj.inhabitants.count()

    @admin.display(description="Children")
    def children_count(self, obj: House) -> int:
        """Display number of children in the house."""
        return obj.children.count()

    @admin.display(description="Cars")
    def car_count(self, obj: House) -> int:
        """Display number of cars in the house."""
        return obj.cars.count()


@admin.register(Child)
class ChildAdmin(admin.ModelAdmin):
    """Admin configuration for Child model."""

    list_display = ("name", "house", "birthdate", "created_at")
    list_filter = ("house",)
    search_fields = ("name", "house__name")
    ordering = ("house__name", "name")


@admin.register(Car)
class CarAdmin(admin.ModelAdmin):
    """Admin configuration for Car model."""

    list_display = ("license_plate", "house", "is_electric", "created_at")
    list_filter = ("house", "is_electric")
    search_fields = ("license_plate", "house__name")
    ordering = ("house__name", "license_plate")
