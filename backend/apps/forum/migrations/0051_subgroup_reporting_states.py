"""Turn the reporting flag into three states: off, open, closed.

Bestyrelsen needs a queue only its own members can read ("der kan jo være
personfølsomme sager"), which the boolean could not express. A second boolean
beside it could — and could also express "closed but switched off", a state with
no meaning that every read site would then have to handle. One field cannot.

Depends on ``reports.0003``: that migration sets ``reporting_enabled`` through
the historical model, so it has to have run before the column goes away.
"""

from django.db import migrations, models


def enabled_to_open(apps, schema_editor):
    Subgroup = apps.get_model("forum", "Subgroup")
    Subgroup.objects.filter(reporting_enabled=True).update(reporting="open")


def open_to_enabled(apps, schema_editor):
    Subgroup = apps.get_model("forum", "Subgroup")
    Subgroup.objects.exclude(reporting="off").update(reporting_enabled=True)


class Migration(migrations.Migration):
    dependencies = [
        ("forum", "0050_subgroup_reporting_enabled"),
        ("reports", "0003_enable_reporting_for_driftsudvalget"),
    ]

    operations = [
        migrations.AddField(
            model_name="subgroup",
            name="reporting",
            field=models.CharField(
                choices=[
                    ("off", "Ingen indrapportering"),
                    ("open", "Åben — alle kan læse sagerne"),
                    ("closed", "Lukket — kun udvalget og indrapportøren kan læse sagerne"),
                ],
                default="off",
                help_text=(
                    "Whether residents can file reports (indrapporteringer) to this group, "
                    "and who may read the queue. The group's members are the caseworkers "
                    "either way, so anything but 'off' requires allows_members."
                ),
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name="subgroup",
            name="reporting_intro",
            field=models.CharField(
                blank=True,
                default="",
                help_text=(
                    "One line under the udvalg's name in the 'Til:' picker, saying what "
                    "belongs here — e.g. 'Fejlmelding af inventar'. Keep it to one line "
                    "on a phone."
                ),
                max_length=120,
            ),
        ),
        migrations.RunPython(enabled_to_open, open_to_enabled),
        migrations.RemoveField(
            model_name="subgroup",
            name="reporting_enabled",
        ),
    ]
