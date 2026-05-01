"""Recompute Subgroup slugs using Danish-aware slugify.

Default Django slugify strips non-ASCII letters, so subgroups like "Fælles"
ended up with slug "flles". This migration recomputes slugs as
"faelles" (etc.) and patches stored notification deep-links accordingly.
"""

from django.db import migrations
from django.utils.text import slugify

_DANISH_TRANSLITERATION = (
    ("æ", "ae"),
    ("Æ", "Ae"),
    ("ø", "oe"),
    ("Ø", "Oe"),
    ("å", "aa"),
    ("Å", "Aa"),
)


def _danish_slugify(value: str) -> str:
    for src, dst in _DANISH_TRANSLITERATION:
        value = value.replace(src, dst)
    return slugify(value)


def recompute_subgroup_slugs(apps, schema_editor):
    Subgroup = apps.get_model("forum", "Subgroup")
    Notification = apps.get_model("notifications", "Notification")

    for subgroup in Subgroup.objects.all().order_by("id"):
        new_slug = _danish_slugify(subgroup.name)
        if not new_slug or new_slug == subgroup.slug:
            continue
        old_slug = subgroup.slug

        candidate = new_slug
        n = 2
        while Subgroup.objects.filter(slug=candidate).exclude(pk=subgroup.pk).exists():
            candidate = f"{new_slug}-{n}"
            n += 1

        subgroup.slug = candidate
        subgroup.save(update_fields=["slug"])

        if old_slug:
            for notif in Notification.objects.filter(link__startswith=f"/forum/{old_slug}"):
                notif.link = notif.link.replace(f"/forum/{old_slug}", f"/forum/{candidate}", 1)
                notif.save(update_fields=["link"])


class Migration(migrations.Migration):
    dependencies = [
        ("forum", "0037_poll_allow_others_to_add_options"),
        ("notifications", "0013_alter_notification_notification_type"),
    ]

    operations = [
        migrations.RunPython(recompute_subgroup_slugs, migrations.RunPython.noop),
    ]
