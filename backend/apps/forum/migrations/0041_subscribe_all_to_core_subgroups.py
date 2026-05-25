"""Subscribe every user to the core community subgroups.

Ensures all users are subscribed to "Fælles", "Arrangementer" and
"Bestyrelsen" so they receive notifications from these central forums.

Subgroup name matching is fuzzy (case-insensitive, whitespace-normalised,
Danish-letter tolerant) to survive minor naming differences. If any of the
three cannot be matched to exactly one subgroup, the migration aborts so a
human can resolve the ambiguity rather than silently subscribing to nothing.
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
    """Return the single subgroup fuzzily matching `target`, or raise."""
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

    if not matches:
        raise RuntimeError(
            f'Could not find a forum subgroup matching "{target}". '
            "Aborting migration so nobody is silently left unsubscribed. "
            "Check the subgroup names in the admin and adjust TARGET_NAMES."
        )
    if len(matches) > 1:
        names = ", ".join(repr(sg.name) for sg in matches)
        raise RuntimeError(
            f'Ambiguous match for "{target}": found {len(matches)} subgroups ({names}). '
            "Resolve the ambiguity before running this migration."
        )
    return matches[0]


def subscribe_all_users(apps, schema_editor):
    Subgroup = apps.get_model("forum", "Subgroup")
    SubgroupSubscription = apps.get_model("forum", "SubgroupSubscription")
    User = apps.get_model("users", "User")

    # Resolve all three targets first; raises and rolls back if any is missing.
    all_subgroups = list(Subgroup.objects.all())
    subgroups = [_find_subgroup(all_subgroups, name) for name in TARGET_NAMES]

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
