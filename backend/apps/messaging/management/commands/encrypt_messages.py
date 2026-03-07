"""
Management command to encrypt existing plaintext messages.

Safe to run multiple times — already-encrypted messages are decrypted
and re-encrypted (idempotent).

Usage:
    uv run python manage.py encrypt_messages
"""

from django.core.management.base import BaseCommand, CommandError

from apps.messaging.models import Message


class Command(BaseCommand):
    help = "Encrypt all message content using MESSAGES_ENCRYPTION_KEY"

    def handle(self, *args, **options):
        from django.conf import settings

        if not settings.MESSAGES_ENCRYPTION_KEY:
            raise CommandError(
                "MESSAGES_ENCRYPTION_KEY is not set. "
                "Set it in your environment before running this command."
            )

        count = 0
        for msg in Message.objects.all().iterator(chunk_size=500):
            # from_db_value decrypts (or passes through plaintext),
            # save() re-encrypts via get_prep_value.
            msg.save(update_fields=["content"])
            count += 1

        self.stdout.write(self.style.SUCCESS(f"Encrypted {count} messages."))
