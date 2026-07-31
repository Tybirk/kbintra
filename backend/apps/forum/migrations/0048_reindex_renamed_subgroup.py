"""Refresh the search rows that embedded the subgroup's old name.

0046 renamed "Arrangementer" to "Begivenheder" with a queryset update, which
fires no post_save — and `RunPython`'s historical models have no signals wired
up regardless. The FTS index therefore kept the old name as the `subtitle` of
every thread, file and folder in that group, so search results went on saying
"Arrangementer" indefinitely (index rows are only rewritten when their object
is saved).
"""

from django.db import migrations

RENAMED_SLUG = "arrangementer"


def reindex_renamed_subgroup(apps, schema_editor):
    """Re-index the renamed group's objects through the normal indexers.

    Deliberately uses the real models and signal handlers rather than the
    historical models: the payload written here has to match what the handlers
    write, and restating it would just drift from them. Wrapped defensively —
    a stale search index must never be the reason a deploy's migrations fail.
    """
    try:
        from apps.forum.models import Subgroup
        from apps.search.signals import index_file, index_folder, index_thread

        subgroup = Subgroup.objects.filter(slug=RENAMED_SLUG).first()
        if subgroup is None:
            return

        for thread in subgroup.threads.all():
            # Cascades to the thread's posts, which embed the group's URL.
            index_thread(None, thread)
        for folder in subgroup.folders.all():
            index_folder(None, folder)
        for file in subgroup.files.all():
            index_file(None, file)
    except Exception:  # noqa: BLE001 — never block a deploy on the search index
        import logging

        logging.getLogger(__name__).exception(
            "Could not reindex %s; run `manage.py rebuild_search_index` to fix search",
            RENAMED_SLUG,
        )


class Migration(migrations.Migration):
    dependencies = [
        ("forum", "0047_postattachment_preview"),
    ]

    operations = [
        migrations.RunPython(reindex_renamed_subgroup, migrations.RunPython.noop),
    ]
