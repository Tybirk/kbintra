"""
Migration 3 of 3: Remove old adults_count, meal_type, and prefers_meat columns.
"""

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("food", "0015_data_migration_adults_meat_veg"),
    ]

    operations = [
        # MealPreference
        migrations.RemoveField(model_name="mealpreference", name="adults_count"),
        migrations.RemoveField(model_name="mealpreference", name="prefers_meat"),
        # MealRegistration
        migrations.RemoveField(model_name="mealregistration", name="adults_count"),
        migrations.RemoveField(model_name="mealregistration", name="meal_type"),
        # FoodTicket
        migrations.RemoveField(model_name="foodticket", name="adults_count"),
        migrations.RemoveField(model_name="foodticket", name="meal_type"),
    ]
