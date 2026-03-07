"""
Management command to bulk upload all existing media files to S3.

Runs synchronously (not via Huey) to avoid flooding the task queue.
"""

import logging
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Upload all existing media files to S3 backup storage."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="List files that would be uploaded without actually uploading.",
        )

    def handle(self, *args, **options):
        from apps.backup.s3 import is_enabled, upload_file

        if not is_enabled():
            self.stderr.write(
                self.style.ERROR("S3 backup is not configured (S3_BACKUP_BUCKET is empty).")
            )
            return

        media_root = Path(settings.MEDIA_ROOT)
        if not media_root.is_dir():
            self.stderr.write(self.style.ERROR(f"MEDIA_ROOT does not exist: {media_root}"))
            return

        dry_run = options["dry_run"]
        files = sorted(f for f in media_root.rglob("*") if f.is_file())

        if not files:
            self.stdout.write("No media files found.")
            return

        self.stdout.write(f"Found {len(files)} media files.")
        if dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN — no files will be uploaded."))

        uploaded = 0
        failed = 0
        for file_path in files:
            relative_path = str(file_path.relative_to(media_root))
            if dry_run:
                self.stdout.write(f"  Would upload: {relative_path}")
            else:
                try:
                    upload_file(relative_path)
                    uploaded += 1
                except Exception:
                    logger.exception("Failed to upload: %s", relative_path)
                    self.stderr.write(self.style.ERROR(f"  Failed: {relative_path}"))
                    failed += 1

        if dry_run:
            self.stdout.write(f"\n{len(files)} files would be uploaded.")
        else:
            self.stdout.write(self.style.SUCCESS(f"\nUploaded {uploaded} files, {failed} failed."))
