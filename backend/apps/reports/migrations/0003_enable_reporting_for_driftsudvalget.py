"""
Switch reporting on for Driftsudvalget.

A data migration rather than a click in admin, because the flag lives on a row
that gets replaced: the test site rsyncs production's database in on every
deploy (``deploy-test.sh``), so a manually-set flag would be gone again minutes
later and the feature would be invisible there. Doing it here means the udvalg
that asked for this feature has it on in every environment, always.

Only Driftsudvalget. Any other udvalg is an admin checkbox, which is the point
of ``reporting_enabled`` being a flag in the first place.
"""

from django.db import migrations

SUBGROUP_SLUG = "driftsudvalget"


def enable_reporting(apps, schema_editor):
    Subgroup = apps.get_model("forum", "Subgroup")
    Subgroup.objects.filter(slug=SUBGROUP_SLUG).update(reporting_enabled=True)


def noop(apps, schema_editor):
    """Deliberately not reversed.

    After this migration the flag is admin-owned; unsetting it on the way back
    down would fight whoever last changed it in admin.
    """


class Migration(migrations.Migration):
    dependencies = [
        ("reports", "0002_reportcounter"),
        ("forum", "0050_subgroup_reporting_enabled"),
    ]

    operations = [
        migrations.RunPython(enable_reporting, noop),
    ]
