"""
Data migration to populate thread slugs for all existing threads.
Processes subgroup by subgroup to respect unique_together constraint.
"""

from django.db import migrations
from django.utils.text import slugify


def populate_thread_slugs(apps, schema_editor):
    Thread = apps.get_model("forum", "Thread")
    Subgroup = apps.get_model("forum", "Subgroup")

    for subgroup in Subgroup.objects.all():
        used_slugs = set()
        threads = Thread.objects.filter(subgroup=subgroup, slug="").order_by("id")
        for thread in threads:
            base = slugify(thread.title, allow_unicode=True) or "traad"
            slug = base
            n = 2
            while slug in used_slugs:
                slug = f"{base}-{n}"
                n += 1
            used_slugs.add(slug)
            thread.slug = slug
            thread.save(update_fields=["slug"])


class Migration(migrations.Migration):
    dependencies = [
        ("forum", "0016_add_thread_slug"),
    ]

    operations = [
        migrations.RunPython(populate_thread_slugs, migrations.RunPython.noop),
    ]
