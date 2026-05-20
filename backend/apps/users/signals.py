"""Signals that regenerate the profile-picture thumbnail when a User's
profile picture is uploaded or replaced.

Pattern mirrors apps/backup/signals.py:
- pre_save: snapshot the old profile_picture name on the instance.
- post_save: compare; if it changed (or the thumbnail is missing), clear
  the stale thumbnail file and queue regeneration via Huey.
"""

from __future__ import annotations

import logging

from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from apps.users.models import User
from apps.users.tasks import generate_user_profile_thumbnail_task

logger = logging.getLogger(__name__)

_OLD_ATTR = "_old_profile_picture_name"


@receiver(pre_save, sender=User)
def _user_pre_save(sender, instance: User, **kwargs) -> None:
    if not instance.pk:
        setattr(instance, _OLD_ATTR, "")
        return
    try:
        old = sender.objects.only("profile_picture").get(pk=instance.pk)
    except sender.DoesNotExist:
        setattr(instance, _OLD_ATTR, "")
        return
    setattr(
        instance,
        _OLD_ATTR,
        old.profile_picture.name if old.profile_picture else "",
    )


@receiver(post_save, sender=User)
def _user_post_save(sender, instance: User, **kwargs) -> None:
    new_name = instance.profile_picture.name if instance.profile_picture else ""
    old_name = getattr(instance, _OLD_ATTR, "")
    if hasattr(instance, _OLD_ATTR):
        delattr(instance, _OLD_ATTR)

    changed = old_name != new_name

    if changed and instance.profile_picture_thumbnail:
        # Old picture is gone or replaced — drop the stale thumbnail file +
        # clear the DB field. Bypass save() so we don't re-fire this signal.
        instance.profile_picture_thumbnail.delete(save=False)
        sender.objects.filter(pk=instance.pk).update(profile_picture_thumbnail="")
        # Keep the in-memory instance consistent.
        instance.profile_picture_thumbnail = None

    if instance.profile_picture and not instance.profile_picture_thumbnail:
        generate_user_profile_thumbnail_task(instance.pk)
        # In dev / tests Huey runs immediately (synchronously), so the
        # thumbnail row has already been updated in the DB by the task.
        # Refresh the in-memory field so the view's serializer (which
        # runs after save() returns) picks up the new thumbnail URL.
        instance.refresh_from_db(fields=["profile_picture_thumbnail"])
