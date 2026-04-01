from django.db import migrations


def clear_pdf_preview_html(apps, schema_editor):
    PostAttachment = apps.get_model("forum", "PostAttachment")
    File = apps.get_model("forum", "File")
    PostAttachment.objects.filter(name__iendswith=".pdf").update(preview_html="")
    File.objects.filter(name__iendswith=".pdf").update(preview_html="")


class Migration(migrations.Migration):
    dependencies = [
        ("forum", "0025_add_icon_to_subgroup"),
    ]

    operations = [
        migrations.RunPython(clear_pdf_preview_html, migrations.RunPython.noop),
    ]
