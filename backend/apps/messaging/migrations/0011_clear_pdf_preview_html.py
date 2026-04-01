from django.db import migrations


def clear_pdf_preview_html(apps, schema_editor):
    MessageAttachment = apps.get_model("messaging", "MessageAttachment")
    MessageAttachment.objects.filter(name__iendswith=".pdf").update(preview_html="")


class Migration(migrations.Migration):
    dependencies = [
        ("messaging", "0010_add_name_to_conversation"),
    ]

    operations = [
        migrations.RunPython(clear_pdf_preview_html, migrations.RunPython.noop),
    ]
