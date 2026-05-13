from django.db import migrations


def normalize_existing_plates(apps, schema_editor):
    # Use the real Car model (not the historical one) so post_save signals
    # fire and refresh the FTS search index titles with the new formatted form.
    from apps.houses.models import Car

    for car in Car.objects.all():
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
