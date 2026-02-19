"""
Add unique_together constraint on (subgroup, slug) for Thread.
Must run after slugs are populated (0017).
"""

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("forum", "0017_populate_thread_slugs"),
    ]

    operations = [
        migrations.AlterUniqueTogether(
            name="thread",
            unique_together={("subgroup", "slug")},
        ),
    ]
