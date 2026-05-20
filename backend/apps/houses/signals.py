"""Profile-picture thumbnail signals for House and Child.

Same pattern as apps/users/signals.py: snapshot old name in pre_save,
detect change in post_save, clear stale thumbnail + queue regeneration.
"""

from __future__ import annotations

import logging

from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from apps.houses.models import Child, House
from apps.houses.tasks import (
    generate_child_thumbnail_task,
    generate_house_thumbnail_task,
)

logger = logging.getLogger(__name__)


def _register(model, attr_name: str, task_fn):
    """Wire up pre_save + post_save handlers for one image-bearing model."""

    @receiver(pre_save, sender=model, weak=False)
    def _pre(sender, instance, **kwargs):
        if not instance.pk:
            setattr(instance, attr_name, "")
            return
        try:
            old = sender.objects.only("profile_picture").get(pk=instance.pk)
        except sender.DoesNotExist:
            setattr(instance, attr_name, "")
            return
        setattr(
            instance,
            attr_name,
            old.profile_picture.name if old.profile_picture else "",
        )

    @receiver(post_save, sender=model, weak=False)
    def _post(sender, instance, **kwargs):
        new_name = instance.profile_picture.name if instance.profile_picture else ""
        old_name = getattr(instance, attr_name, "")
        if hasattr(instance, attr_name):
            delattr(instance, attr_name)

        if old_name != new_name and instance.profile_picture_thumbnail:
            instance.profile_picture_thumbnail.delete(save=False)
            sender.objects.filter(pk=instance.pk).update(profile_picture_thumbnail="")
            instance.profile_picture_thumbnail = None

        if instance.profile_picture and not instance.profile_picture_thumbnail:
            task_fn(instance.pk)
            # In immediate mode Huey ran sync; refresh so callers (serializer
            # to_representation) see the freshly populated thumbnail field.
            instance.refresh_from_db(fields=["profile_picture_thumbnail"])


_register(House, "_old_house_pp", generate_house_thumbnail_task)
_register(Child, "_old_child_pp", generate_child_thumbnail_task)
