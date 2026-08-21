from collections import defaultdict

from django.db import migrations


def lowercase_emails(apps, schema_editor):
    """Rewrite existing addresses in the canonical form `User.save()` now enforces.

    Rows written before that override kept whatever casing the member typed,
    which is how a capitalised address ended up unable to log in: the login
    lookup is an exact match, so `Anna@example.com` and `anna@example.com` were
    two different keys.

    Refuses to run if two members differ only by case — lowercasing those would
    hit the unique index, and picking a winner is not a decision a migration
    should make silently.
    """
    User = apps.get_model("users", "User")

    by_normalized = defaultdict(list)
    for pk, email in User.objects.values_list("pk", "email").order_by("pk"):
        by_normalized[email.strip().lower()].append((pk, email))

    collisions = {normalized: rows for normalized, rows in by_normalized.items() if len(rows) > 1}
    if collisions:
        detail = "; ".join(
            f"{normalized} <- " + ", ".join(f"#{pk} {email!r}" for pk, email in rows)
            for normalized, rows in sorted(collisions.items())
        )
        raise RuntimeError(
            "Cannot normalise email addresses: these members differ only by case and "
            "would collide on the unique index. Merge or correct them in the admin "
            f"first, then run the migration again. {detail}"
        )

    for normalized, rows in by_normalized.items():
        pk, email = rows[0]
        if email != normalized:
            User.objects.filter(pk=pk).update(email=normalized)


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0014_user_carsharing_terms_accepted_at_and_more"),
    ]

    operations = [
        # No reverse: the original casing isn't recorded anywhere, and nothing
        # reads it.
        migrations.RunPython(lowercase_emails, migrations.RunPython.noop),
    ]
