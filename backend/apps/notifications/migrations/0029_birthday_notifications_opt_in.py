"""Birthday notifications become opt-in, and are switched off for everyone.

0026 shipped the in-app birthday toggle on by default. With ~180 birthdays a
year that is a bell notification roughly every other day for every resident.
On PROD on 2026-10-05, 99 of 100 preference rows still had it on — the
default, not a choice; push and e-mail were already off by default and on for
nobody.

So the default flips and every existing row is reset. The upcoming-birthdays
list in the app is untouched; the people who want the morning notice need one
switch on /notifikationer/indstillinger.
"""

from django.db import migrations, models


def birthdays_off_for_everyone(apps, schema_editor):
    NotificationPreference = apps.get_model("notifications", "NotificationPreference")
    NotificationPreference.objects.filter(notify_birthdays=True).update(notify_birthdays=False)


def birthdays_on_for_everyone(apps, schema_editor):
    """Reverse: restore 0026's state, where the toggle was on for everybody."""
    NotificationPreference = apps.get_model("notifications", "NotificationPreference")
    NotificationPreference.objects.filter(notify_birthdays=False).update(notify_birthdays=True)


class Migration(migrations.Migration):
    dependencies = [
        ("notifications", "0028_event_thread_links"),
    ]

    operations = [
        migrations.AlterField(
            model_name="notificationpreference",
            name="notify_birthdays",
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(birthdays_off_for_everyone, birthdays_on_for_everyone),
    ]
