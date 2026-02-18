"""
Replace Event.room (ForeignKey) with Event.rooms (ManyToManyField).

Steps:
1. Add rooms M2M field
2. Migrate existing FK data into M2M
3. Remove old index that referenced room_id
4. Remove FK field
"""

from django.db import migrations, models


def copy_fk_to_m2m(apps, schema_editor):
    """Copy existing room FK values into the new M2M table."""
    Event = apps.get_model("events", "Event")
    for event in Event.objects.filter(room__isnull=False):
        event.rooms.add(event.room_id)


class Migration(migrations.Migration):
    dependencies = [
        ("bookings", "0001_initial"),
        ("events", "0002_eventreminderlog"),
    ]

    operations = [
        # Step 1: Add M2M field
        migrations.AddField(
            model_name="event",
            name="rooms",
            field=models.ManyToManyField(
                blank=True,
                related_name="events",
                to="bookings.room",
            ),
        ),
        # Step 2: Copy existing FK data
        migrations.RunPython(copy_fk_to_m2m, migrations.RunPython.noop),
        # Step 3: Remove the old index
        migrations.RemoveIndex(
            model_name="event",
            name="events_even_room_id_a85085_idx",
        ),
        # Step 4: Remove FK field
        migrations.RemoveField(
            model_name="event",
            name="room",
        ),
    ]
