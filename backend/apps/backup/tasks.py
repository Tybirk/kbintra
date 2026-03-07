"""
Huey background tasks for S3 backup operations.
"""

import logging
import sqlite3
import tempfile
from datetime import UTC, datetime

from huey.contrib.djhuey import db_task

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


@db_task(retries=2, retry_delay=120)
def backup_database_to_s3_task() -> None:
    """Create a consistent SQLite backup and upload it to S3."""
    logger.info("backup_database_to_s3_task STARTED")
    from django.conf import settings

    from apps.backup.s3 import is_enabled, upload_local_file

    if not is_enabled():
        logger.info("backup_database_to_s3_task SKIPPED: S3 not configured")
        return

    db_path = str(settings.DATABASES["default"]["NAME"])
    timestamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    s3_key = f"{settings.S3_BACKUP_PREFIX}db-backups/db-{timestamp}.sqlite3"

    with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=True) as tmp:
        src = sqlite3.connect(db_path)
        dst = sqlite3.connect(tmp.name)
        src.backup(dst)
        dst.close()
        src.close()
        logger.info("Database snapshot created: %s", tmp.name)

        upload_local_file(tmp.name, s3_key)

    logger.info("backup_database_to_s3_task COMPLETED: %s", s3_key)
