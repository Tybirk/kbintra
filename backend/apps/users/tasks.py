"""Huey background tasks for the users app."""

from __future__ import annotations

import logging

from huey.contrib.djhuey import db_periodic_task, db_task

from config.scheduling import local_crontab

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


@db_periodic_task(local_crontab(hour=8, minute=0))
def send_birthday_notifications() -> None:
    """Run daily at 08:00 to tell every active resident whose birthday it is today.

    One notification per birthday, adults and children alike, so each can link
    to the right page: a resident to their profile, a child to their house. The
    person having the birthday is not told about their own.
    """
    from django.utils import timezone

    from apps.houses.models import Child
    from apps.notifications.services import notify_birthday
    from apps.users.models import User
    from apps.users.views import _next_birthday

    today = timezone.localdate()

    def is_today(birthdate) -> bool:  # type: ignore[no-untyped-def]
        return _next_birthday(birthdate, today) == today

    residents = list(User.objects.filter(is_active=True).select_related("notification_preferences"))
    sent = 0

    for person in residents:
        if not person.birthdate or not is_today(person.birthdate):
            continue
        name = f"{person.first_name} {person.last_name}".strip() or person.email
        for recipient in residents:
            if recipient.pk == person.pk:
                continue
            notify_birthday(
                recipient,
                name,
                None if person.hide_birth_year else today.year - person.birthdate.year,
                f"/profil/{person.pk}",
                related_user=person,
            )
            sent += 1

    for child in Child.objects.filter(birthdate__isnull=False).select_related("house"):
        if not is_today(child.birthdate):
            continue
        name = f"{child.name} ({child.house.name})"
        for recipient in residents:
            notify_birthday(
                recipient,
                name,
                today.year - child.birthdate.year,
                f"/beboere/hus/{child.house.slug}",
            )
            sent += 1

    logger.info("Sent %d birthday notifications for %s", sent, today)
