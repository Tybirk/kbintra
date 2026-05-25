from django.db import migrations

PLACEHOLDER_CONTENT = "<p>Brug denne tråd til at diskutere arrangementet.</p>"


def delete_placeholder_posts(apps, schema_editor):
    """Remove the auto-generated placeholder post that used to seed every event thread.

    The UI now renders an info banner in its place; the DB record is dead data.
    Also wipes the corresponding FTS5 search_index rows so search doesn't return
    hits pointing at deleted posts.
    """
    Post = apps.get_model("forum", "Post")
    placeholder_ids = list(
        Post.objects.filter(
            thread__event__isnull=False,
            content=PLACEHOLDER_CONTENT,
        ).values_list("id", flat=True)
    )
    if not placeholder_ids:
        return

    with schema_editor.connection.cursor() as cursor:
        cursor.executemany(
            "DELETE FROM search_index WHERE type = %s AND object_id = %s",
            [("post", str(pid)) for pid in placeholder_ids],
        )

    Post.objects.filter(id__in=placeholder_ids).delete()


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("events", "0007_add_edited_by"),
        ("forum", "0039_subgroup_links_info_members"),
    ]

    operations = [
        migrations.RunPython(delete_placeholder_posts, noop_reverse),
    ]
