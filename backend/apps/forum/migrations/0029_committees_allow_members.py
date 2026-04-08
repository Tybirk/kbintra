"""Data migration: existing committees opt into allows_members."""

from django.db import migrations


def flip_committees(apps, schema_editor):
    Subgroup = apps.get_model("forum", "Subgroup")
    Subgroup.objects.filter(is_committee=True).update(allows_members=True)


def reverse(apps, schema_editor):
    Subgroup = apps.get_model("forum", "Subgroup")
    Subgroup.objects.filter(is_committee=True).update(allows_members=False)


class Migration(migrations.Migration):
    dependencies = [
        ("forum", "0028_file_members_only_subgroup_allows_members_and_more"),
    ]

    operations = [
        migrations.RunPython(flip_committees, reverse),
    ]
