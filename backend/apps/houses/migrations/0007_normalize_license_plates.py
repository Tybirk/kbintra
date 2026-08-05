from django.db import migrations


def normalize_existing_plates(apps, schema_editor):
    # Use the historical model: the concrete one selects every column that
    # exists *today*, which breaks a from-scratch migration run as soon as a
    # later migration adds a field (e.g. houses.0010 adding delebilpark columns).
    # Every install that had plates to normalise has long since run this, and a
    # fresh database has no cars here, so no search reindex is needed — the
    # post_save signal this used to rely on has nothing to do either way.
    Car = apps.get_model("houses", "Car")

    from apps.houses.utils import normalize_license_plate

    for car in Car.objects.all():
        normalized = normalize_license_plate(car.license_plate)
        if normalized != car.license_plate:
            car.license_plate = normalized
            car.save(update_fields=["license_plate"])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("houses", "0006_alter_car_license_plate"),
    ]

    operations = [
        migrations.RunPython(normalize_existing_plates, noop_reverse),
    ]
