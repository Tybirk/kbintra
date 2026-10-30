"""Huey background tasks for the houses app."""

from __future__ import annotations

import logging

from huey import crontab
from huey.contrib.djhuey import db_periodic_task, db_task

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


@db_periodic_task(crontab(minute="5"))
def process_due_handovers() -> None:
    """Hourly: carry out every handover step whose day has come (see
    apps.houses.handover). Hourly rather than daily so a missed run costs an
    hour, not a day; a step that has run is stamped and never runs again."""
    from .handover import process_handover
    from .models import Handover

    open_ids = Handover.objects.filter(access_ended_at__isnull=True).values_list("id", flat=True)
    for handover_id in list(open_ids):
        try:
            process_handover(handover_id)
        except Exception:
            # One broken handover must not hold up the others.
            logger.exception("Processing handover %s failed", handover_id)


@db_task(retries=3, retry_delay=60)
def send_invitation_email_task(invitation_id: int) -> None:
    """Mail a new resident their invitation, with what to do once they are in."""
    from django.conf import settings
    from django.core.mail import EmailMessage

    from apps.users.models import Invitation

    from .handover import invitation_email, register_url

    invitation = Invitation.objects.filter(pk=invitation_id, used_at__isnull=True).first()
    if invitation is None:
        return
    subject, body = invitation_email(invitation.first_name, register_url(invitation))
    EmailMessage(
        subject=subject,
        body=body,
        to=[invitation.email],
        from_email=settings.DEFAULT_FROM_EMAIL,
    ).send()
    logger.info("Sent invitation %s", invitation_id)
