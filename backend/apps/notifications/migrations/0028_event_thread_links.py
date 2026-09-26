"""Older notifications about posts in event threads link to the thread itself.

Replies, reactions and admin edits in an event thread used to link via
/kalender/<slug>#post-N, which only redirected to the forum thread; since
95f7fab new ones link straight to /forum/<group>/traad/<thread>#post-N. The old
rows kept /kalender/ as their aggregation key too, so a new reply sat beside an
unread old one instead of counting it up (45 rows on the prod copy of
2026-09-26, 8 unread). Rows for events without a thread are left alone, and
bulk_update leaves updated_at (and so the feed order) as it was.
"""

from django.db import migrations


def forwards(apps, schema_editor):
    Event = apps.get_model("events", "Event")
    Notification = apps.get_model("notifications", "Notification")

    thread_url = {
        event.slug: f"/forum/{event.thread.subgroup.slug}/traad/{event.thread.slug}"
        for event in Event.objects.filter(thread__isnull=False).select_related("thread__subgroup")
    }

    def moved(value: str) -> str:
        slug, hash_mark, fragment = value.removeprefix("/kalender/").partition("#")
        base = thread_url.get(slug)
        if not value.startswith("/kalender/") or base is None:
            return value
        return base + hash_mark + fragment

    # Only notifications about a post (their link carries #post-N); event
    # notifications proper (reminders, changes) keep their /kalender/ links.
    changed = []
    for notification in Notification.objects.filter(link__regex=r"^/kalender/[^#]+#post-"):
        link, group_key = moved(notification.link), moved(notification.group_key)
        if (link, group_key) != (notification.link, notification.group_key):
            notification.link, notification.group_key = link, group_key
            changed.append(notification)
    Notification.objects.bulk_update(changed, ["link", "group_key"], batch_size=200)


class Migration(migrations.Migration):
    dependencies = [
        ("notifications", "0027_collapse_stacked_reply_counts"),
        ("events", "0008_drop_placeholder_event_posts"),
    ]

    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
