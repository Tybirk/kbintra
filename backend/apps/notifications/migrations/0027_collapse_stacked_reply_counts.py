"""Collapse titles like "Mad (2 nye svar) (3 nye svar) (4 nye svar)" to "Mad (4 nye svar)".

The aggregation appended a new count instead of replacing the old one; 599
notifications on the prod copy of 2026-09-25 carry the stack.
"""

import re

from django.db import migrations

STACKED = re.compile(r"(?: \(\d+ nye svar\))+( \(\d+ nye svar\))$")


def collapse(apps, schema_editor):
    Notification = apps.get_model("notifications", "Notification")
    stacked = Notification.objects.filter(title__contains="nye svar) (")
    # bulk_update touches only the title, so updated_at (and the feed order) stays.
    Notification.objects.bulk_update(
        [
            Notification(id=n.id, title=STACKED.sub(r"\1", n.title))
            for n in stacked.only("id", "title")
        ],
        ["title"],
        batch_size=500,
    )


class Migration(migrations.Migration):
    dependencies = [("notifications", "0026_birthday_notifications")]

    operations = [migrations.RunPython(collapse, migrations.RunPython.noop)]
