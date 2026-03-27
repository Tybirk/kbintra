"""
Thin wrapper around boto3 for S3-compatible backup storage.

All operations are no-ops when S3_BACKUP_BUCKET is not configured.
"""

import logging
from pathlib import Path

from django.conf import settings

logger = logging.getLogger(__name__)


def is_enabled() -> bool:
    return bool(getattr(settings, "S3_BACKUP_BUCKET", ""))


def _get_client():
    import boto3

    return boto3.client(
        "s3",
        endpoint_url=settings.S3_BACKUP_ENDPOINT,
        aws_access_key_id=settings.S3_BACKUP_ACCESS_KEY,
        aws_secret_access_key=settings.S3_BACKUP_SECRET_KEY,
        region_name=settings.S3_BACKUP_REGION,
    )


def _s3_key(relative_path: str) -> str:
    return f"{settings.S3_BACKUP_PREFIX}{relative_path}"


def upload_file(relative_path: str) -> None:
    """Upload a local media file to S3. `relative_path` is relative to MEDIA_ROOT."""
    if not is_enabled():
        return
    local_path = Path(settings.MEDIA_ROOT) / relative_path
    if not local_path.is_file():
        logger.warning("upload_file: local file missing: %s", local_path)
        return
    client = _get_client()
    key = _s3_key(relative_path)
    client.upload_file(str(local_path), settings.S3_BACKUP_BUCKET, key)
    logger.info("Uploaded to S3: %s", key)


def download_file(relative_path: str) -> bool:
    """Download a file from S3 to local MEDIA_ROOT. Returns True on success."""
    if not is_enabled():
        return False
    local_path = Path(settings.MEDIA_ROOT) / relative_path
    local_path.parent.mkdir(parents=True, exist_ok=True)
    client = _get_client()
    key = _s3_key(relative_path)
    try:
        client.download_file(settings.S3_BACKUP_BUCKET, key, str(local_path))
        logger.info("Restored from S3: %s", key)
        return True
    except client.exceptions.NoSuchKey:
        logger.warning("download_file: not found in S3: %s", key)
        return False
    except Exception:
        logger.exception("download_file: failed for %s", key)
        return False


def delete_file(relative_path: str) -> None:
    """Delete a file from S3."""
    if not is_enabled():
        return
    client = _get_client()
    key = _s3_key(relative_path)
    client.delete_object(Bucket=settings.S3_BACKUP_BUCKET, Key=key)
    logger.info("Deleted from S3: %s", key)
