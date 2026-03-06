"""
Track EncryptedTextField in Django's migration state.

EncryptedTextField is a TextField subclass — no DB schema change needed.
Existing message data is encrypted via the `encrypt_messages` management command.
"""

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("messaging", "0006_messageattachment_preview_html"),
    ]

    # No operations needed: EncryptedTextField has the same DB column type as TextField.
    # Data encryption is handled by the `encrypt_messages` management command.
    operations = []
