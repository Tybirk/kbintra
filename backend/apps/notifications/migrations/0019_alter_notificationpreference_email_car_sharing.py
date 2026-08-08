"""Turn bildeling emails on, for new residents and for the ones already here.

A new default only reaches rows created after it, and every existing resident has
a row from the first time they opened the settings page. Without the backfill the
change would apply to almost nobody.

Flipping existing rows is safe *only because* nothing could have set this
deliberately: the field shipped defaulting to False, bildeling has never been live
for the community, and the preferences page is where the row is created. Anyone
who turns it off after this migration keeps it off — reverse() puts everything
back to False, which is the state this replaces, not each resident's own choice.
"""

from django.db import migrations, models


def turn_car_sharing_email_on(apps, schema_editor):
    NotificationPreference = apps.get_model("notifications", "NotificationPreference")
    NotificationPreference.objects.filter(email_car_sharing=False).update(email_car_sharing=True)


def turn_car_sharing_email_off(apps, schema_editor):
    NotificationPreference = apps.get_model("notifications", "NotificationPreference")
    NotificationPreference.objects.update(email_car_sharing=False)


class Migration(migrations.Migration):
    dependencies = [
        ("notifications", "0018_notificationpreference_email_car_sharing_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="notificationpreference",
            name="email_car_sharing",
            field=models.BooleanField(default=True),
        ),
        migrations.RunPython(turn_car_sharing_email_on, turn_car_sharing_email_off),
    ]
