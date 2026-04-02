"""
Refactor MealPreference, MealRegistration, and FoodTicket to be per-house.

MealPreference: user FK → house FK + last_modified_by FK
MealRegistration: user FK → house FK (required) + last_modified_by FK
FoodTicket: add house FK (required)

Multi-step: add new fields → migrate data → remove old fields → new constraints.
"""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def migrate_data_forward(apps, schema_editor):
    """Populate new house FKs and deduplicate records."""
    MealPreference = apps.get_model("food", "MealPreference")
    MealRegistration = apps.get_model("food", "MealRegistration")
    FoodTicket = apps.get_model("food", "FoodTicket")

    # --- MealPreference: copy user.house → house, user → last_modified_by ---
    for pref in MealPreference.objects.select_related("user").all():
        if pref.user and pref.user.house_id:
            pref.house_new = pref.user.house
            pref.last_modified_by = pref.user
            pref.save(update_fields=["house_new", "last_modified_by"])

    # Delete preferences with no house (orphans)
    MealPreference.objects.filter(house_new__isnull=True).delete()

    # Deduplicate: keep highest PK per (house, day_of_week)
    seen = set()
    to_delete = []
    for pref in MealPreference.objects.order_by("-pk"):
        key = (pref.house_new_id, pref.day_of_week)
        if key in seen:
            to_delete.append(pref.pk)
        else:
            seen.add(key)
    if to_delete:
        MealPreference.objects.filter(pk__in=to_delete).delete()

    # --- MealRegistration: copy user → last_modified_by, ensure house is set ---
    for reg in MealRegistration.objects.select_related("user").all():
        reg.last_modified_by = reg.user
        if not reg.house_id and reg.user and reg.user.house_id:
            reg.house = reg.user.house
        reg.save(update_fields=["last_modified_by", "house"])

    # Delete registrations with no house
    MealRegistration.objects.filter(house__isnull=True).delete()

    # Deduplicate: keep most recently updated per (house, date)
    seen = set()
    to_delete = []
    for reg in MealRegistration.objects.order_by("-updated_at", "-pk"):
        key = (reg.house_id, reg.date)
        if key in seen:
            to_delete.append(reg.pk)
        else:
            seen.add(key)
    if to_delete:
        MealRegistration.objects.filter(pk__in=to_delete).delete()

    # --- FoodTicket: set house from owner ---
    for ticket in FoodTicket.objects.select_related("owner").all():
        if ticket.owner and ticket.owner.house_id:
            ticket.house = ticket.owner.house
            ticket.save(update_fields=["house"])

    # Delete tickets with no house
    FoodTicket.objects.filter(house__isnull=True).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("food", "0018_add_drive_folder_id"),
        ("houses", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # Step 1: Add new fields (nullable initially)
        # MealPreference: add house_new (to avoid clash with existing field name) and last_modified_by
        migrations.AddField(
            model_name="mealpreference",
            name="house_new",
            field=models.ForeignKey(
                null=True,
                blank=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="meal_preferences_new",
                to="houses.house",
            ),
        ),
        migrations.AddField(
            model_name="mealpreference",
            name="last_modified_by",
            field=models.ForeignKey(
                null=True,
                blank=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="modified_preferences",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        # MealRegistration: add last_modified_by
        migrations.AddField(
            model_name="mealregistration",
            name="last_modified_by",
            field=models.ForeignKey(
                null=True,
                blank=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="modified_registrations",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        # FoodTicket: add house (nullable initially)
        migrations.AddField(
            model_name="foodticket",
            name="house",
            field=models.ForeignKey(
                null=True,
                blank=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="house_food_tickets",
                to="houses.house",
                help_text="The house whose registration these portions come from",
            ),
        ),
        # Step 2: Data migration
        migrations.RunPython(migrate_data_forward, migrations.RunPython.noop),
        # Step 3: Remove old unique constraints and user FK from MealPreference
        migrations.AlterUniqueTogether(
            name="mealpreference",
            unique_together=set(),
        ),
        migrations.RemoveField(
            model_name="mealpreference",
            name="user",
        ),
        # Rename house_new → house on MealPreference
        migrations.RenameField(
            model_name="mealpreference",
            old_name="house_new",
            new_name="house",
        ),
        # Make house non-nullable on MealPreference
        migrations.AlterField(
            model_name="mealpreference",
            name="house",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="meal_preferences",
                to="houses.house",
            ),
        ),
        # New unique constraint on MealPreference
        migrations.AlterUniqueTogether(
            name="mealpreference",
            unique_together={("house", "day_of_week")},
        ),
        # Step 4: Remove old unique constraint and user FK from MealRegistration
        migrations.AlterUniqueTogether(
            name="mealregistration",
            unique_together=set(),
        ),
        migrations.RemoveField(
            model_name="mealregistration",
            name="user",
        ),
        # Make house non-nullable on MealRegistration
        migrations.AlterField(
            model_name="mealregistration",
            name="house",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="meal_registrations",
                to="houses.house",
            ),
        ),
        # New unique constraint on MealRegistration
        migrations.AlterUniqueTogether(
            name="mealregistration",
            unique_together={("house", "date")},
        ),
        # Step 5: Make house non-nullable on FoodTicket
        migrations.AlterField(
            model_name="foodticket",
            name="house",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="house_food_tickets",
                to="houses.house",
                help_text="The house whose registration these portions come from",
            ),
        ),
    ]
