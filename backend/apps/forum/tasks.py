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
    from apps.forum.image_processing import generate_attachment_thumbnail
    from apps.forum.models import PostAttachment

    att = PostAttachment.objects.filter(id=attachment_id).first()
    if att and generate_attachment_thumbnail(att):
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
    # A missing source file is handled (and logged) inside the helper, which
    # returns False for it — nothing is raised here.
    if generate_attachment_preview(att):
        logger.info("Generated web preview for %s.%s %s", app_label, model_name, attachment_id)
