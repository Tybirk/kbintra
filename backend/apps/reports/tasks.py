"""Huey background tasks for the Indrapportering app."""

from __future__ import annotations

import logging

from huey.contrib.djhuey import db_task

logger = logging.getLogger(__name__)


@db_task(retries=2, retry_delay=30)
def generate_report_photo_thumbnail_task(photo_id: int) -> None:
    """Generate a small thumbnail for a ReportPhoto.

    Mirrors ``apps.forum.tasks.generate_post_attachment_thumbnail_task`` and
    reuses the same Pillow helpers. No-ops if the photo is gone, already has a
    thumbnail, or isn't an image we handle; Pillow open errors are swallowed
    inside ``generate_thumbnail`` so one corrupt upload doesn't retry forever.
    """
    from apps.forum.image_processing import generate_thumbnail, is_image_attachment

    from .models import ReportPhoto

    photo = ReportPhoto.objects.filter(id=photo_id).first()
    if not photo:
        return
    if photo.thumbnail:
        return
    if not is_image_attachment(photo.name):
        return

    try:
        with photo.image.open("rb") as src:
            thumb = generate_thumbnail(src)
    except FileNotFoundError:
        logger.warning("Skipping thumbnail for report photo %s: source file missing", photo_id)
        return

    if thumb is None:
        return

    photo.thumbnail.save(f"{photo.id}.jpg", thumb, save=False)
    photo.save(update_fields=["thumbnail"])
    logger.info("Generated thumbnail for report photo %s", photo_id)
