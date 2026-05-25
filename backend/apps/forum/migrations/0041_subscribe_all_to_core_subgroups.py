"""Subscribe every user to the core community subgroups.

One-time backfill that subscribes all users to "Fælles", "Arrangementer" and
"Bestyrelsen" so they receive notifications from these central forums.

This only does anything on a populated database (i.e. the real prod data set,
where these subgroups already exist). On a fresh/empty database — such as the
CI test database, where migrations run before any data exists — there are no
subgroups to match, so each missing target is simply skipped and the migration
is a harmless no-op. Subgroup name matching is fuzzy (case-insensitive,
whitespace-normalised, Danish-letter tolerant) to survive minor naming
differences.
"""

from django.db import migrations

# Subgroups every user should be subscribed to.
TARGET_NAMES = ["Fælles", "Arrangementer", "Bestyrelsen"]

_DANISH_TRANSLITERATION = (
    ("æ", "ae"),
    ("ø", "oe"),
    ("å", "aa"),
)


def _normalise(value: str) -> str:
    """Lowercase, collapse whitespace and transliterate Danish letters."""
    value = " ".join(value.split()).lower()
    for src, dst in _DANISH_TRANSLITERATION:
        value = value.replace(src, dst)
    return value


def _find_subgroup(subgroups, target: str):
    """Return the single subgroup fuzzily matching `target`, or None."""
    norm_target = _normalise(target)

    # Prefer an exact normalised-name match.
    matches = [sg for sg in subgroups if _normalise(sg.name) == norm_target]

    if not matches:
        # Fall back to a substring match either direction.
        matches = [
            sg
            for sg in subgroups
            if norm_target in _normalise(sg.name) or _normalise(sg.name) in norm_target
        ]

    # No match (e.g. fresh/empty DB) or an ambiguous match: skip rather than
    # guess. The original prod backfill has already run; remaining runs are
    # only fresh DBs where there is nothing meaningful to subscribe.
    if len(matches) != 1:
        return None
    return matches[0]


def subscribe_all_users(apps, schema_editor):
    Subgroup = apps.get_model("forum", "Subgroup")
    SubgroupSubscription = apps.get_model("forum", "SubgroupSubscription")
    User = apps.get_model("users", "User")

    all_subgroups = list(Subgroup.objects.all())
    subgroups = [sg for name in TARGET_NAMES if (sg := _find_subgroup(all_subgroups, name))]

    for subgroup in subgroups:
        existing_user_ids = set(
            SubgroupSubscription.objects.filter(subgroup=subgroup).values_list("user_id", flat=True)
        )
        to_create = [
            SubgroupSubscription(user=user, subgroup=subgroup)
            for user in User.objects.all()
            if user.pk not in existing_user_ids
        ]
        SubgroupSubscription.objects.bulk_create(to_create)


class Migration(migrations.Migration):
    dependencies = [
        ("forum", "0040_postattachment_thumbnail"),
        ("users", "0011_user_profile_picture_thumbnail"),
    ]

    operations = [
        migrations.RunPython(subscribe_all_users, migrations.RunPython.noop),
    ]
