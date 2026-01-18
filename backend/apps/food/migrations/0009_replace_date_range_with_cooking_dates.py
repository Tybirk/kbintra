# Generated manually - replaces date range with specific cooking dates

from datetime import timedelta

from django.db import migrations, models


def convert_date_range_to_cooking_dates(apps, schema_editor):
    """Convert start_date/end_date range to list of cooking dates."""
    FoodTeamCycle = apps.get_model("food", "FoodTeamCycle")

    for cycle in FoodTeamCycle.objects.all():
        dates = []
        current = cycle.start_date
        while current <= cycle.end_date:
            # Only include Mon-Thu (weekday 0-3)
            if current.weekday() <= 3:
                dates.append(current.isoformat())
            current += timedelta(days=1)
        cycle.cooking_dates = dates
        cycle.save(update_fields=["cooking_dates"])


def reverse_migration(apps, schema_editor):
    """Reverse: convert cooking_dates back to start_date/end_date."""
    FoodTeamCycle = apps.get_model("food", "FoodTeamCycle")
    from datetime import date

    for cycle in FoodTeamCycle.objects.all():
        if cycle.cooking_dates:
            # Parse the first and last dates
            cycle.start_date = date.fromisoformat(cycle.cooking_dates[0])
            cycle.end_date = date.fromisoformat(cycle.cooking_dates[-1])
            cycle.save(update_fields=["start_date", "end_date"])


class Migration(migrations.Migration):
    dependencies = [
        ("food", "0008_food_team_cycles_and_wishes"),
    ]

    operations = [
        # 1. Add the new cooking_dates field (with default empty list)
        migrations.AddField(
            model_name="foodteamcycle",
            name="cooking_dates",
            field=models.JSONField(
                default=list,
                help_text="List of cooking dates (ISO format strings: YYYY-MM-DD)",
            ),
        ),
        # 2. Migrate data from start_date/end_date to cooking_dates
        migrations.RunPython(convert_date_range_to_cooking_dates, reverse_migration),
        # 3. Remove old fields
        migrations.RemoveField(
            model_name="foodteamcycle",
            name="end_date",
        ),
        migrations.RemoveField(
            model_name="foodteamcycle",
            name="start_date",
        ),
        # 4. Update ordering
        migrations.AlterModelOptions(
            name="foodteamcycle",
            options={"ordering": ["-created_at"]},
        ),
    ]
