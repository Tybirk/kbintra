"""
Management command to backup the SQLite database to S3.

Creates a consistent snapshot via sqlite3.backup() and uploads it directly.
Runs synchronously (not via Huey) for use in deploy scripts.
"""

import os
import sqlite3
import tempfile
from datetime import UTC, datetime

from django.conf import settings
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Backup the SQLite database to S3."

    def handle(self, *args, **options):
        from apps.backup.s3 import is_enabled, upload_local_file

        if not is_enabled():
            self.stderr.write(
                self.style.ERROR("S3 backup is not configured (S3_BACKUP_BUCKET is empty).")
            )
            return

        db_path = str(settings.DATABASES["default"]["NAME"])
        timestamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
        s3_key = f"{settings.S3_BACKUP_PREFIX}db-backups/db-{timestamp}.sqlite3"

        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".sqlite3")
        os.close(tmp_fd)
        try:
            src = sqlite3.connect(db_path)
            dst = sqlite3.connect(tmp_path)
            src.backup(dst, pages=256, sleep=0.1)
            dst.close()
            src.close()

            upload_local_file(tmp_path, s3_key)
        finally:
            os.unlink(tmp_path)

        self.stdout.write(self.style.SUCCESS(f"Database backed up to S3: {s3_key}"))
