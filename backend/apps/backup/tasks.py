"""
Huey background tasks for S3 media backup operations.

Database backups are handled by Litestream (continuous WAL replication to S3).
"""

import logging

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
