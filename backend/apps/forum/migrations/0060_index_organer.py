"""Put the organer created by 0057 into the search index.

0057 creates Generalforsamling and Fællesmøde through `RunPython`'s historical
models, which have no signals wired up, so neither group got a search row and
both stayed unsearchable until someone ran `rebuild_search_index` (which the
deploy only does on an empty index). This runs last, once the real model's
columns all exist, and indexes them through the normal handler.
"""

from django.db import migrations

ORGAN_SLUGS = ["generalforsamling", "faellesmoede"]


def index_organer(apps, schema_editor):
    """Index through the real handler, as 0048 does, so the row matches a save.

    Wrapped defensively — a stale search index must never be the reason a
    deploy's migrations fail.
    """
    try:
        from apps.forum.models import Subgroup
        from apps.search.signals import index_subgroup

        for subgroup in Subgroup.objects.filter(group_type__in=ORGAN_SLUGS):
            index_subgroup(None, subgroup, created=True)
    except Exception:  # noqa: BLE001 — never block a deploy on the search index
        import logging

        logging.getLogger(__name__).exception(
            "Could not index the organer; run `manage.py rebuild_search_index` to fix search"
        )


class Migration(migrations.Migration):
    dependencies = [
        ("forum", "0059_subgroup_lifecycle"),
        ("search", "0003_keep_original_text"),
    ]

    operations = [
        migrations.RunPython(index_organer, migrations.RunPython.noop),
    ]
