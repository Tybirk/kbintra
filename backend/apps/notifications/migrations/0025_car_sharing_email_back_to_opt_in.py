"""Undo the blanket bildeling e-mail opt-in from migration 0019.

0019 set ``email_car_sharing`` on for every existing resident, because bildeling
requests wait on one named recipient and push was not configured yet — the in-app
bell was the only other signal. Push is live now, so the reason is gone.

What it left behind is worse than a stale default. Every other e-mail toggle is
off until a resident turns it on, so "has this person got any e-mail channel on?"
is the app's test for *does this resident use e-mail at all* — it is what decides
whether the handful of toggle-less notifications (the madhold period
announcements, the pause check, an udlæg outcome) reach them by mail. One toggle
switched on by a migration rather than by a person makes that test answer yes for
everybody, and nobody actually opted in to any of it.

So both halves go back: the default, and the rows 0019 flipped. We cannot tell a
resident's own yes from the migration's, and since 0019 set all of them the
overwhelming majority are the migration's — resetting is the honest reading.
Bildeling e-mail is now what every other channel is: off until you ask for it.
Say so in Fælles rather than in a release note; the people who want it back need
one switch on /notifikationer/indstillinger.
"""

from django.db import migrations, models


def car_sharing_email_back_to_opt_in(apps, schema_editor):
    NotificationPreference = apps.get_model("notifications", "NotificationPreference")
    NotificationPreference.objects.filter(email_car_sharing=True).update(email_car_sharing=False)


def turn_car_sharing_email_on(apps, schema_editor):
    """Reverse: restore what 0019 left, so a rollback lands where it started."""
    NotificationPreference = apps.get_model("notifications", "NotificationPreference")
    NotificationPreference.objects.filter(email_car_sharing=False).update(email_car_sharing=True)


class Migration(migrations.Migration):
    dependencies = [
        ("notifications", "0024_alter_notification_notification_type"),
    ]

    operations = [
        migrations.AlterField(
            model_name="notificationpreference",
            name="email_car_sharing",
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(car_sharing_email_back_to_opt_in, turn_car_sharing_email_on),
    ]
