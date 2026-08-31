"""Seed the initial meal price sets.

The baseline row carries the prices that were hardcoded in `constants.py` up
until now, starting far enough back to cover every registration ever made. The
second row is the 2026-08-02 increase. Because prices are resolved by meal date,
this keeps all historical cost reports and economy pages exactly as they were.
"""

from datetime import date
from decimal import Decimal

from django.db import migrations

# Well before the first meal registration — the baseline covers all history.
BASELINE_START = date(2000, 1, 1)
PRICE_INCREASE_START = date(2026, 8, 2)


def seed_prices(apps, schema_editor):
    MealPrice = apps.get_model("food", "MealPrice")

    MealPrice.objects.get_or_create(
        effective_from=BASELINE_START,
        defaults={
            "price_adult_meat": Decimal("37.00"),
            "price_adult_veg": Decimal("26.00"),
            "price_child": Decimal("18.00"),
            "note": "Oprindelige priser",
        },
    )
    MealPrice.objects.get_or_create(
        effective_from=PRICE_INCREASE_START,
        defaults={
            "price_adult_meat": Decimal("40.00"),
            "price_adult_veg": Decimal("30.00"),
            "price_child": Decimal("18.00"),
            "note": "Prisstigning august 2026",
        },
    )


def unseed_prices(apps, schema_editor):
    MealPrice = apps.get_model("food", "MealPrice")
    MealPrice.objects.filter(effective_from__in=[BASELINE_START, PRICE_INCREASE_START]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("food", "0022_mealprice"),
    ]

    operations = [
        migrations.RunPython(seed_prices, unseed_prices),
    ]
