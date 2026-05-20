"""Huey background tasks for the users app."""

from __future__ import annotations

import logging

from huey.contrib.djhuey import db_task

logger = logging.getLogger(__name__)


@db_task(retries=2, retry_delay=30)
def generate_user_profile_thumbnail_task(user_id: int) -> None:
    """Generate a 400×400 JPEG thumbnail for a user's profile picture.

    No-ops if the user is gone, has no profile picture, or already has a
    thumbnail. Pillow errors are swallowed inside `generate_thumbnail`.
    """
    from apps.forum.image_processing import generate_thumbnail
    from apps.users.models import User

    user = User.objects.filter(id=user_id).first()
    if not user or not user.profile_picture or user.profile_picture_thumbnail:
        return

    try:
        with user.profile_picture.open("rb") as src:
            thumb = generate_thumbnail(src)
    except FileNotFoundError:
        logger.warning("Skipping profile thumbnail for user %s: source file missing", user_id)
        return

    if thumb is None:
        return

    user.profile_picture_thumbnail.save(f"{user.id}.jpg", thumb, save=True)
    logger.info("Generated profile thumbnail for user %s", user_id)
