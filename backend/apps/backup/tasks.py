"""
Huey background tasks for S3 backup operations.
"""

import logging
import os
import sqlite3
import tempfile
from datetime import UTC, datetime

from huey import crontab
from huey.contrib.djhuey import db_periodic_task, db_task

logger = logging.getLogger(__name__)


@db_task(retries=3, retry_delay=60)
def backup_file_to_s3_task(relative_path: str) -> None:
    """Upload a media file to S3 in the background."""
    logger.info("backup_file_to_s3_task STARTED: %s", relative_path)
    from apps.backup.s3 import upload_file

    upload_file(relative_path)
    logger.info("backup_file_to_s3_task COMPLETED: %s", relative_path)


@db_task(retries=2, retry_delay=60)
def delete_file_from_s3_task(relative_path: str) -> None:
    """Delete a media file from S3 in the background."""
    logger.info("delete_file_from_s3_task STARTED: %s", relative_path)
    from apps.backup.s3 import delete_file

    delete_file(relative_path)
    logger.info("delete_file_from_s3_task COMPLETED: %s", relative_path)


def _create_and_upload_db_snapshot() -> None:
    """Create a consistent SQLite backup and upload it to S3."""
    from django.conf import settings

    from apps.backup.s3 import is_enabled, prune_old_db_backups, upload_local_file

    if not is_enabled():
        logger.info("DB backup SKIPPED: S3 not configured")
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
        logger.info("Database snapshot created: %s", tmp_path)

        upload_local_file(tmp_path, s3_key)
        logger.info("DB backup COMPLETED: %s", s3_key)
    finally:
        os.unlink(tmp_path)

    prune_old_db_backups(keep=30)


@db_task(retries=2, retry_delay=120)
def backup_database_to_s3_task() -> None:
    """Create a consistent SQLite backup and upload it to S3 (on-demand)."""
    logger.info("backup_database_to_s3_task STARTED")
    _create_and_upload_db_snapshot()


@db_periodic_task(crontab(hour="3", minute="0"))
def backup_database_to_s3_periodic() -> None:
    """Daily 3 AM database backup to S3."""
    logger.info("backup_database_to_s3_periodic STARTED")
    _create_and_upload_db_snapshot()
