# Generated migration

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("events", "0004_event_cancellation"),
        ("forum", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="event",
            name="thread",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="event",
                to="forum.thread",
            ),
        ),
    ]
