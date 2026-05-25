"""Huey background tasks for the houses app."""

from __future__ import annotations

import logging

from huey.contrib.djhuey import db_task

logger = logging.getLogger(__name__)


def _generate_profile_thumbnail(instance, label: str) -> None:
    """Shared core for House + Child thumbnail generation."""
    from apps.forum.image_processing import generate_thumbnail

    if not instance.profile_picture or instance.profile_picture_thumbnail:
        return

    try:
        with instance.profile_picture.open("rb") as src:
            thumb = generate_thumbnail(src)
    except FileNotFoundError:
        logger.warning("Skipping %s thumbnail for id=%s: source file missing", label, instance.pk)
        return

    if thumb is None:
        return

    instance.profile_picture_thumbnail.save(f"{instance.pk}.jpg", thumb, save=True)
    logger.info("Generated %s thumbnail for id=%s", label, instance.pk)


@db_task(retries=2, retry_delay=30)
def generate_house_thumbnail_task(house_id: int) -> None:
    from apps.houses.models import House

    house = House.objects.filter(id=house_id).first()
    if house:
        _generate_profile_thumbnail(house, "house")


@db_task(retries=2, retry_delay=30)
def generate_child_thumbnail_task(child_id: int) -> None:
    from apps.houses.models import Child

    child = Child.objects.filter(id=child_id).first()
    if child:
        _generate_profile_thumbnail(child, "child")
