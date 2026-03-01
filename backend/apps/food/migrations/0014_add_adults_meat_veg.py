"""
Migration 1 of 3: Add adults_meat and adults_veg columns to MealRegistration,
FoodTicket, and MealPreference.
"""

from django.db import migrations, models
from django.core.validators import MinValueValidator


class Migration(migrations.Migration):
    dependencies = [
        ("food", "0013_alter_foodteamcycle_status_and_more"),
    ]

    operations = [
        # MealPreference
        migrations.AddField(
            model_name="mealpreference",
            name="adults_meat",
            field=models.PositiveIntegerField(
                default=0, validators=[MinValueValidator(0)]
            ),
        ),
        migrations.AddField(
            model_name="mealpreference",
            name="adults_veg",
            field=models.PositiveIntegerField(
                default=0, validators=[MinValueValidator(0)]
            ),
        ),
        # MealRegistration
        migrations.AddField(
            model_name="mealregistration",
            name="adults_meat",
            field=models.PositiveIntegerField(
                default=0, validators=[MinValueValidator(0)]
            ),
        ),
        migrations.AddField(
            model_name="mealregistration",
            name="adults_veg",
            field=models.PositiveIntegerField(
                default=0, validators=[MinValueValidator(0)]
            ),
        ),
        # FoodTicket
        migrations.AddField(
            model_name="foodticket",
            name="adults_meat",
            field=models.PositiveIntegerField(
                default=0, validators=[MinValueValidator(0)]
            ),
        ),
        migrations.AddField(
            model_name="foodticket",
            name="adults_veg",
            field=models.PositiveIntegerField(
                default=0, validators=[MinValueValidator(0)]
            ),
        ),
    ]
