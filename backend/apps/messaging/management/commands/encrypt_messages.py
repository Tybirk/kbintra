"""
Management command to encrypt existing plaintext messages, and the text of polls
(their question and options are encrypted the same way — see forum.Poll).

Safe to run multiple times — already-encrypted messages are decrypted
and re-encrypted (idempotent).

Usage:
    uv run python manage.py encrypt_messages
"""

from django.core.management.base import BaseCommand, CommandError

from apps.forum.models import Poll, PollOption
from apps.messaging.models import Message


class Command(BaseCommand):
    help = "Encrypt all message content and poll text using MESSAGES_ENCRYPTION_KEY"

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

        for model, field in ((Poll, "question"), (PollOption, "text")):
            count = 0
            for obj in model.objects.all().iterator(chunk_size=500):
                obj.save(update_fields=[field])
                count += 1
            self.stdout.write(
                self.style.SUCCESS(f"Encrypted {count} {model._meta.verbose_name_plural}.")
            )
