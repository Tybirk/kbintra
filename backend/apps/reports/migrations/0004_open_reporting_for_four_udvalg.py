"""Open indrapportering for the four udvalg with a driftsansvar.

Driftsudvalget had it alone; Terkild asked for "DU, GU, VU, BU — alle med et
driftsansvar" so residents have one place to report regardless of who owns the
thing that is broken.

A data migration rather than four clicks in admin, for the same reason as
``0003``: the test site rsyncs production's database in on every deploy, so a
manually-set flag is gone again minutes later.

Bestyrelsen is deliberately not here. It would have to be CLOSED, and whether it
should exist at all is a fællesmøde decision — after which it is one dropdown in
admin, no deploy.
"""

from django.db import migrations

# slug -> the one line shown under the udvalg's name in the "Til:" picker.
INTROS = {
    "driftsudvalget": "Fejlmelding af inventar og fællesarealer",
    "groent-udvalg": "Grønne forslag og udearealer",
    "vaerkstedsudvalget": "Værksted, værktøj og maskiner",
    "boern-og-ungeudvalget": "Legeplads og børneområder",
}


def open_reporting(apps, schema_editor):
    Subgroup = apps.get_model("forum", "Subgroup")
    for slug, intro in INTROS.items():
        Subgroup.objects.filter(slug=slug).update(reporting="open", reporting_intro=intro)


def noop(apps, schema_editor):
    """Deliberately not reversed — see 0003. The flags are admin-owned after this."""


class Migration(migrations.Migration):
    dependencies = [
        ("reports", "0003_enable_reporting_for_driftsudvalget"),
        ("forum", "0051_subgroup_reporting_states"),
    ]

    operations = [
        migrations.RunPython(open_reporting, noop),
    ]
