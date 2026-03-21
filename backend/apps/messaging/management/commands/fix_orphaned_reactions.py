"""
Delete MessageReaction rows that reference messages which no longer exist.

Usage:
    uv run python manage.py fix_orphaned_reactions
    uv run python manage.py fix_orphaned_reactions --dry-run
"""

from django.core.management.base import BaseCommand
from django.db import connection


class Command(BaseCommand):
    help = "Delete orphaned message reactions (referencing deleted messages)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Only report orphaned rows, don't delete them",
        )

    def handle(self, *args, **options):
        cursor = connection.cursor()

        cursor.execute(
            """
            SELECT mr.id, mr.message_id
            FROM messaging_messagereaction mr
            LEFT JOIN messaging_message m ON mr.message_id = m.id
            WHERE m.id IS NULL
            """
        )
        orphans = cursor.fetchall()

        if not orphans:
            self.stdout.write(self.style.SUCCESS("No orphaned reactions found."))
            return

        for reaction_id, message_id in orphans:
            self.stdout.write(f"  Orphaned: reaction id={reaction_id}, message_id={message_id}")

        if options["dry_run"]:
            self.stdout.write(self.style.WARNING(f"\nDry run: {len(orphans)} orphaned reactions."))
            return

        cursor.execute(
            """
            DELETE FROM messaging_messagereaction
            WHERE message_id NOT IN (SELECT id FROM messaging_message)
            """
        )
        self.stdout.write(self.style.SUCCESS(f"\nDeleted {cursor.rowcount} orphaned reactions."))
