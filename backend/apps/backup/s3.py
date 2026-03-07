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


def upload_local_file(local_path: str, s3_key: str) -> None:
    """Upload an arbitrary local file to S3 with an explicit key. Used for DB backups."""
    if not is_enabled():
        return
    if not Path(local_path).is_file():
        logger.warning("upload_local_file: file missing: %s", local_path)
        return
    client = _get_client()
    client.upload_file(local_path, settings.S3_BACKUP_BUCKET, s3_key)
    logger.info("Uploaded to S3: %s", s3_key)


def prune_old_db_backups(keep: int = 30) -> int:
    """Delete old DB backups from S3, keeping the most recent `keep` snapshots. Returns count deleted."""
    if not is_enabled():
        return 0
    client = _get_client()
    prefix = f"{settings.S3_BACKUP_PREFIX}db-backups/"
    paginator = client.get_paginator("list_objects_v2")
    all_keys = []
    for page in paginator.paginate(Bucket=settings.S3_BACKUP_BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []):
            all_keys.append(obj["Key"])

    all_keys.sort()
    to_delete = all_keys[:-keep] if len(all_keys) > keep else []
    for key in to_delete:
        client.delete_object(Bucket=settings.S3_BACKUP_BUCKET, Key=key)
        logger.info("Pruned old DB backup: %s", key)
    if to_delete:
        logger.info(
            "Pruned %d old DB backups, kept %d", len(to_delete), len(all_keys) - len(to_delete)
        )
    return len(to_delete)
