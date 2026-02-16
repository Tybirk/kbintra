"""
Data migration: Mark all existing threads as read for all existing users.

This prevents the feature from showing everything as unread on day one.
"""

from django.db import migrations
from django.utils import timezone


def mark_all_threads_read(apps, schema_editor):
    User = apps.get_model("users", "User")
    Thread = apps.get_model("forum", "Thread")
    ThreadReadStatus = apps.get_model("forum", "ThreadReadStatus")

    now = timezone.now()
    users = User.objects.all()
    threads = Thread.objects.all()

    records = []
    for user in users:
        for thread in threads:
            records.append(ThreadReadStatus(user=user, thread=thread, last_read_at=now))

    if records:
        ThreadReadStatus.objects.bulk_create(records, batch_size=1000)


def reverse_noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("forum", "0012_threadreadstatus"),
        ("users", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(mark_all_threads_read, reverse_noop),
    ]
