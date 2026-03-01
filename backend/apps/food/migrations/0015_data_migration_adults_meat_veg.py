"""
Migration 2 of 3: Data migration to populate adults_meat and adults_veg from
the old adults_count / meal_type / prefers_meat fields.

Forward:
- Non-Wednesday: adults_meat=0, adults_veg=adults_count (meat-only-Wednesday rule)
- Wednesday + meat: adults_meat=adults_count, adults_veg=0
- Wednesday + vegetarian: adults_meat=0, adults_veg=adults_count
- MealPreference: same logic using day_of_week (2=Wednesday)

Reverse:
- adults_meat > 0 → meal_type="meat" / prefers_meat=True, adults_count=sum
- else → meal_type="vegetarian" / prefers_meat=False, adults_count=sum
"""

from django.db import migrations


def forward(apps, schema_editor):
    MealRegistration = apps.get_model("food", "MealRegistration")
    FoodTicket = apps.get_model("food", "FoodTicket")
    MealPreference = apps.get_model("food", "MealPreference")

    # MealRegistration
    for reg in MealRegistration.objects.all():
        is_wednesday = reg.date.weekday() == 2
        if is_wednesday and reg.meal_type == "meat":
            reg.adults_meat = reg.adults_count
            reg.adults_veg = 0
        else:
            reg.adults_meat = 0
            reg.adults_veg = reg.adults_count
        reg.save(update_fields=["adults_meat", "adults_veg"])

    # FoodTicket
    for ticket in FoodTicket.objects.all():
        is_wednesday = ticket.date.weekday() == 2
        if is_wednesday and ticket.meal_type == "meat":
            ticket.adults_meat = ticket.adults_count
            ticket.adults_veg = 0
        else:
            ticket.adults_meat = 0
            ticket.adults_veg = ticket.adults_count
        ticket.save(update_fields=["adults_meat", "adults_veg"])

    # MealPreference
    for pref in MealPreference.objects.all():
        is_wednesday = pref.day_of_week == 2
        if is_wednesday and pref.prefers_meat:
            pref.adults_meat = pref.adults_count
            pref.adults_veg = 0
        else:
            pref.adults_meat = 0
            pref.adults_veg = pref.adults_count
        pref.save(update_fields=["adults_meat", "adults_veg"])


def reverse(apps, schema_editor):
    MealRegistration = apps.get_model("food", "MealRegistration")
    FoodTicket = apps.get_model("food", "FoodTicket")
    MealPreference = apps.get_model("food", "MealPreference")

    for reg in MealRegistration.objects.all():
        reg.adults_count = reg.adults_meat + reg.adults_veg
        reg.meal_type = "meat" if reg.adults_meat > 0 else "vegetarian"
        reg.save(update_fields=["adults_count", "meal_type"])

    for ticket in FoodTicket.objects.all():
        ticket.adults_count = ticket.adults_meat + ticket.adults_veg
        ticket.meal_type = "meat" if ticket.adults_meat > 0 else "vegetarian"
        ticket.save(update_fields=["adults_count", "meal_type"])

    for pref in MealPreference.objects.all():
        pref.adults_count = pref.adults_meat + pref.adults_veg
        pref.prefers_meat = pref.adults_meat > 0
        pref.save(update_fields=["adults_count", "prefers_meat"])


class Migration(migrations.Migration):
    dependencies = [
        ("food", "0014_add_adults_meat_veg"),
    ]

    operations = [
        migrations.RunPython(forward, reverse),
    ]
