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
            thumb = generate_thumbnail(src)
    except FileNotFoundError:
        logger.warning("Skipping thumbnail for attachment %s: source file missing", attachment_id)
        return

    if thumb is None:
        return

    # Persist only this column — the preview task writes `preview` on its own
    # instance at the same time, and a full-row save would clobber it.
    att.thumbnail.save(f"{att.id}.jpg", thumb, save=False)
    att.save(update_fields=["thumbnail"])
    logger.info("Generated thumbnail for attachment %s", attachment_id)


@db_task(retries=2, retry_delay=30)
def generate_attachment_preview_task(app_label: str, model_name: str, attachment_id: int) -> None:
    """Generate a web-viewable JPEG `preview` for a HEIC/HEIF attachment.

    Generic across attachment models with `file`, `name`, and `preview` fields
    (forum / messaging / announcements), so HEIC images uploaded anywhere become
    viewable in browsers that can't decode them. No-ops for non-HEIC files,
    missing rows, or attachments already converted.
    """
    from django.apps import apps as django_apps

    from apps.forum.image_processing import generate_attachment_preview

    model = django_apps.get_model(app_label, model_name)
    att = model.objects.filter(id=attachment_id).first()
    if not att:
        return
    try:
        if generate_attachment_preview(att):
            logger.info("Generated web preview for %s.%s %s", app_label, model_name, attachment_id)
    except FileNotFoundError:
        logger.warning(
            "Skipping preview for %s.%s %s: source file missing",
            app_label,
            model_name,
            attachment_id,
        )
