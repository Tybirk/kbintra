"""Add slug field to Folder model and backfill existing folders."""

from django.db import migrations, models
from django.utils.text import slugify


def backfill_folder_slugs(apps, schema_editor):
    Folder = apps.get_model("forum", "Folder")
    for folder in Folder.objects.all():
        base = slugify(folder.name, allow_unicode=True) or "mappe"
        slug = base
        n = 2
        while (
            Folder.objects.filter(subgroup=folder.subgroup, slug=slug)
            .exclude(pk=folder.pk)
            .exists()
        ):
            slug = f"{base}-{n}"
            n += 1
        folder.slug = slug
        folder.save(update_fields=["slug"])


class Migration(migrations.Migration):
    dependencies = [
        ("forum", "0020_threadmutestatus"),
    ]

    operations = [
        migrations.AddField(
            model_name="folder",
            name="slug",
            field=models.SlugField(allow_unicode=True, blank=True, max_length=100),
        ),
        migrations.RunPython(backfill_folder_slugs, migrations.RunPython.noop),
        migrations.AlterUniqueTogether(
            name="folder",
            unique_together={("subgroup", "parent", "name"), ("subgroup", "slug")},
        ),
    ]
