"""
Huey background tasks for S3 media backup operations.

Database backups are handled by Litestream (continuous WAL replication to S3).
The check_litestream_health periodic task monitors that replication is working.
"""

import logging

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


LITESTREAM_S3_PREFIX = "litestream/db/"
# Threshold is generous because this is a ~90-user community app with long
# overnight quiet periods; Litestream only ships WAL when there are writes.
LITESTREAM_MAX_AGE_MINUTES = 240
# Only alarm during waking hours so a quiet night doesn't page anyone.
LITESTREAM_CHECK_HOUR_START = 8
LITESTREAM_CHECK_HOUR_END = 22  # exclusive


def _is_active_hour() -> bool:
    """True when the current Copenhagen-local time is inside the alarm window."""
    import zoneinfo
    from datetime import datetime

    local_hour = datetime.now(zoneinfo.ZoneInfo("Europe/Copenhagen")).hour
    return LITESTREAM_CHECK_HOUR_START <= local_hour < LITESTREAM_CHECK_HOUR_END


def _check_litestream_health() -> None:
    """Check that Litestream is replicating to S3.

    Lists recent objects under the litestream/ prefix and verifies something
    was modified within the configured threshold. Raises on failure so Sentry
    captures it automatically via the Huey integration.

    Skipped outside 08:00-22:00 Copenhagen time — overnight write activity is
    sporadic and the alarm would fire on benign gaps.
    """
    from datetime import UTC, datetime

    from django.conf import settings

    from apps.backup.s3 import _get_client, is_enabled

    if not is_enabled():
        return

    if not _is_active_hour():
        return

    client = _get_client()
    response = client.list_objects_v2(
        Bucket=settings.S3_BACKUP_BUCKET,
        Prefix=LITESTREAM_S3_PREFIX,
        MaxKeys=50,
    )

    objects = response.get("Contents", [])
    if not objects:
        raise RuntimeError(
            f"Litestream backup health check FAILED: no objects found under '{LITESTREAM_S3_PREFIX}' "
            f"in bucket '{settings.S3_BACKUP_BUCKET}'. Replication may never have started."
        )

    newest = max(obj["LastModified"] for obj in objects)
    age_minutes = (datetime.now(UTC) - newest).total_seconds() / 60

    if age_minutes > LITESTREAM_MAX_AGE_MINUTES:
        raise RuntimeError(
            f"Litestream backup health check FAILED: newest object under '{LITESTREAM_S3_PREFIX}' "
            f"is {age_minutes:.0f} minutes old (threshold: {LITESTREAM_MAX_AGE_MINUTES}m). "
            f"Replication may have stopped."
        )

    logger.info(
        "Litestream backup health OK: newest replica object is %.0f minutes old", age_minutes
    )


@db_periodic_task(crontab(minute="0"))
def check_litestream_health() -> None:
    """Hourly check that Litestream is replicating to S3."""
    _check_litestream_health()
