"""Huey background tasks for the forum app."""

from __future__ import annotations

import logging

from huey.contrib.djhuey import db_task

logger = logging.getLogger(__name__)


@db_task(retries=2, retry_delay=30)
def generate_post_attachment_thumbnail_task(attachment_id: int) -> None:
    """Generate a small thumbnail for a PostAttachment if it's an image.

    No-ops if the attachment is gone, already has a thumbnail, or isn't an
    image. Pillow open errors are swallowed inside `generate_thumbnail` so
    a single corrupt upload doesn't keep retrying forever.
    """
    from apps.forum.image_processing import generate_thumbnail, is_image_attachment
    from apps.forum.models import PostAttachment

    att = PostAttachment.objects.filter(id=attachment_id).first()
    if not att:
        return
    if att.thumbnail:
        return
    if not is_image_attachment(att.name):
        return

    try:
        with att.file.open("rb") as src:
            thumb = generate_thumbnail(src, preserve_aspect=True)
    except FileNotFoundError:
        logger.warning("Skipping thumbnail for attachment %s: source file missing", attachment_id)
        return

    if thumb is None:
        return

    att.thumbnail.save(f"{att.id}.jpg", thumb, save=True)
    logger.info("Generated thumbnail for attachment %s", attachment_id)
