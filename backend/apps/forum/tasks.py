"""
Huey background tasks for the forum app.
"""

import logging
import zipfile
from pathlib import Path

from huey import crontab
from huey.contrib.djhuey import db_periodic_task, db_task

logger = logging.getLogger(__name__)

MAX_ZIP_SIZE = 200 * 1024 * 1024 * 1024  # 200 GB


class _ZipSizeLimitError(Exception):
    """Raised when cumulative zip content exceeds the size limit."""


def _add_folder_to_zip(zf: zipfile.ZipFile, folder_id: int, prefix: str, total_size: int) -> int:
    """Recursively add all files in a folder and its children to zf.

    Returns the cumulative size so far; raises _ZipSizeLimitError if it
    exceeds MAX_ZIP_SIZE.
    """
    from .models import File, Folder

    folder_obj = Folder.objects.get(id=folder_id)
    path = f"{prefix}{folder_obj.name}/"
    for file_obj in File.objects.filter(folder=folder_obj):
        if file_obj.file and file_obj.file.storage.exists(file_obj.file.name):
            total_size += file_obj.file.size
            if total_size > MAX_ZIP_SIZE:
                raise _ZipSizeLimitError
            zf.write(file_obj.file.path, arcname=f"{path}{file_obj.name}")
    for subfolder in Folder.objects.filter(parent=folder_obj):
        total_size = _add_folder_to_zip(zf, subfolder.id, path, total_size)
    return total_size


@db_task()
def build_folder_zip(job_id: int) -> None:
    """Build a zip file on disk for a ZipDownloadJob."""
    from datetime import timedelta

    from django.conf import settings
    from django.utils import timezone

    from .models import ZipDownloadJob

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
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            _add_folder_to_zip(zf, job.folder_id, "", 0)

        job.status = ZipDownloadJob.STATUS_READY
        job.zip_path = str(zip_path)
        # Expiry starts from when the zip is ready to download
        job.expires_at = timezone.now() + timedelta(hours=2)
        job.save(update_fields=["status", "zip_path", "expires_at"])
        logger.info("build_folder_zip: job %d ready at %s", job_id, zip_path)
    except _ZipSizeLimitError:
        logger.warning("build_folder_zip: job %d exceeded size limit", job_id)
        if zip_path.exists():
            zip_path.unlink()
        job.status = ZipDownloadJob.STATUS_FAILED
        job.error = "Mappen er for stor til at downloade som zip (maks 200 GB)."
        job.save(update_fields=["status", "error"])
    except Exception:
        logger.exception("build_folder_zip: job %d failed", job_id)
        if zip_path.exists():
            zip_path.unlink()
        job.status = ZipDownloadJob.STATUS_FAILED
        job.error = "Der opstod en fejl under opbygning af zip-filen."
        job.save(update_fields=["status", "error"])


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
