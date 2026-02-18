import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("events", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="EventReminderLog",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "reminder_type",
                    models.CharField(
                        choices=[("24h", "24 timer før"), ("1h", "1 time før")],
                        max_length=10,
                    ),
                ),
                ("sent_at", models.DateTimeField(auto_now_add=True)),
                ("recipients_count", models.IntegerField(default=0)),
                (
                    "event",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="reminder_logs",
                        to="events.event",
                    ),
                ),
            ],
            options={
                "unique_together": {("event", "reminder_type")},
            },
        ),
    ]
