"""Data migration: convert reaction_type slugs to emoji characters."""

from django.db import migrations

SLUG_TO_EMOJI = {
    "like": "\U0001f44d",
    "heart": "\u2764\ufe0f",
    "laugh": "\U0001f602",
    "surprised": "\U0001f62e",
    "sad": "\U0001f622",
    "celebrate": "\U0001f389",
    "claim": "\U0001f64b",
}


def forwards(apps, schema_editor):
    MessageReaction = apps.get_model("messaging", "MessageReaction")
    for slug, emoji in SLUG_TO_EMOJI.items():
        MessageReaction.objects.filter(reaction_type=slug).update(reaction_type=emoji)


def backwards(apps, schema_editor):
    MessageReaction = apps.get_model("messaging", "MessageReaction")
    for slug, emoji in SLUG_TO_EMOJI.items():
        MessageReaction.objects.filter(reaction_type=emoji).update(reaction_type=slug)


class Migration(migrations.Migration):
    dependencies = [
        ("messaging", "0012_alter_reaction_type_free_emoji"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
