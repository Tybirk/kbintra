from django.db import migrations


def clear_pdf_preview_html(apps, schema_editor):
    AnnouncementAttachment = apps.get_model("announcements", "AnnouncementAttachment")
    AnnouncementAttachment.objects.filter(name__iendswith=".pdf").update(preview_html="")


class Migration(migrations.Migration):
    dependencies = [
        ("announcements", "0004_add_show_on_dashboard_to_announcement"),
    ]

    operations = [
        migrations.RunPython(clear_pdf_preview_html, migrations.RunPython.noop),
    ]
