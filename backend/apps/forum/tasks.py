"""
Huey background tasks for the forum app.
"""

import logging
import zipfile
from pathlib import Path
from typing import Any

from huey import crontab
from huey.contrib.djhuey import db_periodic_task, db_task

logger = logging.getLogger(__name__)


def _add_folder_to_zip(zf: zipfile.ZipFile, folder_obj: Any, prefix: str) -> None:
    """Recursively add all files in folder_obj and its children to zf."""
    from .models import File, Folder  # safe: models are loaded before tasks run

    path = f"{prefix}{folder_obj.name}/"
    for file_obj in File.objects.filter(folder=folder_obj):
        if file_obj.file and file_obj.file.storage.exists(file_obj.file.name):
            zf.write(file_obj.file.path, arcname=f"{path}{file_obj.name}")
    for subfolder in Folder.objects.filter(parent=folder_obj):
        _add_folder_to_zip(zf, subfolder, path)


@db_task()
def build_folder_zip(job_id: int) -> None:
    """Build a zip file on disk for a ZipDownloadJob."""
    from datetime import timedelta

    from django.conf import settings
    from django.utils import timezone

    from .models import Folder, ZipDownloadJob

    try:
        job = ZipDownloadJob.objects.get(id=job_id)
    except ZipDownloadJob.DoesNotExist:
        logger.warning("build_folder_zip: job %d not found", job_id)
        return

    job.status = ZipDownloadJob.STATUS_BUILDING
    job.save(update_fields=["status"])

    zip_dir = Path(settings.MEDIA_ROOT) / "zip_downloads"
    zip_dir.mkdir(exist_ok=True)
    zip_path = zip_dir / f"{job.token}.zip"

    try:
        folder = Folder.objects.get(id=job.folder_id)
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            _add_folder_to_zip(zf, folder, "")

        job.status = ZipDownloadJob.STATUS_READY
        job.zip_path = str(zip_path)
        job.expires_at = timezone.now() + timedelta(hours=2)
        job.save(update_fields=["status", "zip_path", "expires_at"])
        logger.info("build_folder_zip: job %d ready at %s", job_id, zip_path)
    except Exception as e:
        logger.exception("build_folder_zip: job %d failed", job_id)
        if zip_path.exists():
            zip_path.unlink()
        job.status = ZipDownloadJob.STATUS_FAILED
        job.error = str(e)[:500]
        job.save(update_fields=["status", "error"])
        raise


@db_periodic_task(crontab(hour="3", minute="0"))
def cleanup_expired_zip_downloads() -> None:
    """Delete expired zip download jobs and their files."""
    from django.utils import timezone

    from .models import ZipDownloadJob

    expired = ZipDownloadJob.objects.filter(expires_at__lt=timezone.now())
    count = 0
    for job in expired:
        if job.zip_path:
            path = Path(job.zip_path)
            if path.exists():
                path.unlink()
        job.delete()
        count += 1
    if count:
        logger.info("cleanup_expired_zip_downloads: deleted %d expired jobs", count)
