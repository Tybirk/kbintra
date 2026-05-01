"""Add slug field to House and populate it from the trailing integer in name."""

from django.db import migrations, models
from django.utils.text import slugify


def _derive_slug(name: str) -> str:
    parts = name.split()
    if parts:
        try:
            return str(int(parts[-1]))
        except ValueError:
            pass
    return slugify(name)


def populate_house_slugs(apps, schema_editor):
    House = apps.get_model("houses", "House")
    used: set[str] = set()
    for house in House.objects.all().order_by("id"):
        if house.slug:
            used.add(house.slug)
            continue
        base = _derive_slug(house.name)
        slug = base
        n = 2
        while slug in used or House.objects.filter(slug=slug).exclude(pk=house.pk).exists():
            slug = f"{base}-{n}"
            n += 1
        house.slug = slug
        used.add(slug)
        house.save(update_fields=["slug"])


class Migration(migrations.Migration):
    dependencies = [
        ("houses", "0004_car"),
    ]

    operations = [
        migrations.AddField(
            model_name="house",
            name="slug",
            field=models.CharField(blank=True, db_index=True, max_length=20),
        ),
        migrations.RunPython(populate_house_slugs, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="house",
            name="slug",
            field=models.CharField(blank=True, db_index=True, max_length=20, unique=True),
        ),
    ]
