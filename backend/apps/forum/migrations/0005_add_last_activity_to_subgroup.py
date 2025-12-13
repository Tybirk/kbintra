# Generated manually

from django.db import migrations, models
from django.db.models import Max


def populate_last_activity(apps, schema_editor):
    """Populate last_activity_at from the latest thread or post activity."""
    Subgroup = apps.get_model("forum", "Subgroup")
    Thread = apps.get_model("forum", "Thread")
    Post = apps.get_model("forum", "Post")

    for subgroup in Subgroup.objects.all():
        # Get the latest thread update time
        latest_thread = Thread.objects.filter(subgroup=subgroup).aggregate(
            latest=Max("updated_at")
        )["latest"]

        # Get the latest post creation time
        latest_post = Post.objects.filter(thread__subgroup=subgroup).aggregate(
            latest=Max("created_at")
        )["latest"]

        # Use the most recent of the two, or fall back to created_at
        candidates = [t for t in [latest_thread, latest_post] if t is not None]
        if candidates:
            subgroup.last_activity_at = max(candidates)
        else:
            subgroup.last_activity_at = subgroup.created_at
        subgroup.save(update_fields=["last_activity_at"])


class Migration(migrations.Migration):

    dependencies = [
        ("forum", "0004_add_subgroup_to_file_and_optional_folder"),
    ]

    operations = [
        migrations.AddField(
            model_name="subgroup",
            name="last_activity_at",
            field=models.DateTimeField(
                blank=True,
                null=True,
                help_text="Updated when a thread or post is created in this subgroup.",
            ),
        ),
        migrations.RunPython(populate_last_activity, migrations.RunPython.noop),
        migrations.AlterModelOptions(
            name="subgroup",
            options={"ordering": ["-is_committee", "-last_activity_at"]},
        ),
    ]
