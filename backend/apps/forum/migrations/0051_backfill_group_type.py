"""Backfill group_type from is_committee and the "Bestyrelsen" subgroup.

Forward maps every subgroup with `is_committee=True` to `group_type="udvalg"`,
and the subgroup named "Bestyrelsen" (fuzzy-matched the same way as migration
0041) to `group_type="bestyrelse"`. Everything else keeps the default
`group_type="almindelig"` set by the previous migration.

On a fresh/empty database (e.g. the CI test database, where migrations run
before any data exists) there is nothing to match, so this is a harmless
no-op. Subgroup name matching is fuzzy (case-insensitive, whitespace-
normalised, Danish-letter tolerant) to survive minor naming differences,
mirroring `0041_subscribe_all_to_core_subgroups.py`.
"""

from django.db import migrations

BESTYRELSE_NAME = "Bestyrelsen"

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
    # guess.
    if len(matches) != 1:
        return None
    return matches[0]


def backfill_group_type(apps, schema_editor):
    Subgroup = apps.get_model("forum", "Subgroup")

    Subgroup.objects.filter(is_committee=True).update(group_type="udvalg")

    all_subgroups = list(Subgroup.objects.all())
    bestyrelsen = _find_subgroup(all_subgroups, BESTYRELSE_NAME)
    if bestyrelsen is not None:
        bestyrelsen.group_type = "bestyrelse"
        bestyrelsen.save(update_fields=["group_type"])


def revert_group_type(apps, schema_editor):
    Subgroup = apps.get_model("forum", "Subgroup")
    Subgroup.objects.filter(group_type="udvalg").update(is_committee=True)


class Migration(migrations.Migration):
    dependencies = [
        ("forum", "0050_subgroup_group_type"),
    ]

    operations = [
        migrations.RunPython(backfill_group_type, revert_group_type),
    ]
