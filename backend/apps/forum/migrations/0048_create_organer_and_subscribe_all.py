"""Create the Generalforsamling and Fællesmøde organer and backfill subscriptions.

Foreningens to øverste organer — Generalforsamlingen og Fællesmødet — findes
ikke som forumgrupper endnu. This migration creates them (if they don't
already exist, matched fuzzily like `0041`), marks them `is_default=True` so
future users are auto-subscribed via the existing registration flow, and
backfills a `SubgroupSubscription` for every existing user to both groups.

Idempotent: skips users already subscribed, and skips creating a group whose
name fuzzily matches an existing one. Harmless no-op on an empty/CI database
besides creating the two groups themselves (there's nothing to subscribe).
"""

from django.db import migrations

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

    matches = [sg for sg in subgroups if _normalise(sg.name) == norm_target]

    if not matches:
        matches = [
            sg
            for sg in subgroups
            if norm_target in _normalise(sg.name) or _normalise(sg.name) in norm_target
        ]

    if len(matches) != 1:
        return None
    return matches[0]


# (name, group_type, slug, icon)
ORGANER = [
    ("Generalforsamling", "generalforsamling", "generalforsamling", "building-bank"),
    ("Fællesmøde", "faellesmoede", "faellesmoede", "users"),
]


def create_organer_and_subscribe_all(apps, schema_editor):
    Subgroup = apps.get_model("forum", "Subgroup")
    SubgroupSubscription = apps.get_model("forum", "SubgroupSubscription")
    User = apps.get_model("users", "User")

    all_subgroups = list(Subgroup.objects.all())
    all_slugs = {sg.slug for sg in all_subgroups}

    organer = []
    for name, group_type, slug, icon in ORGANER:
        existing = _find_subgroup(all_subgroups, name)
        if existing is None:
            # Guard against an existing, unrelated group already owning the
            # slug we want to use.
            unique_slug = slug
            suffix = 2
            while unique_slug in all_slugs:
                unique_slug = f"{slug}-{suffix}"
                suffix += 1
            existing = Subgroup.objects.create(
                name=name,
                slug=unique_slug,
                group_type=group_type,
                is_default=True,
                icon=icon,
            )
            all_subgroups.append(existing)
            all_slugs.add(unique_slug)
        organer.append(existing)

    for subgroup in organer:
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
        ("forum", "0047_remove_subgroup_is_committee"),
    ]

    operations = [
        migrations.RunPython(create_organer_and_subscribe_all, migrations.RunPython.noop),
    ]
