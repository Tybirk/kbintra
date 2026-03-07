"""
Django signals to automatically sync media files to S3 backup storage.

Attachment models (PostAttachment, File, MessageAttachment, AnnouncementAttachment)
are immutable — only backup on create, delete on delete.

Image models (User.profile_picture, House.profile_picture, Room.image)
can be replaced — backup on every save when the field has a value.
"""

import logging

from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

from .s3 import is_enabled
from .tasks import backup_file_to_s3_task, delete_file_from_s3_task

logger = logging.getLogger(__name__)

# -- Attachment models (immutable files: backup on create, delete on delete) --

ATTACHMENT_MODELS = [
    ("forum.PostAttachment", "file"),
    ("forum.File", "file"),
    ("messaging.MessageAttachment", "file"),
    ("announcements.AnnouncementAttachment", "file"),
]


def _attachment_post_save(sender, instance, created, field_name, **kwargs):
    if not created or not is_enabled():
        return
    file_field = getattr(instance, field_name, None)
    if file_field and file_field.name:
        backup_file_to_s3_task(file_field.name)


def _attachment_post_delete(sender, instance, field_name, **kwargs):
    if not is_enabled():
        return
    file_field = getattr(instance, field_name, None)
    if file_field and file_field.name:
        delete_file_from_s3_task(file_field.name)


for _model_label, _field_name in ATTACHMENT_MODELS:

    def _make_save_handler(field_name):
        def handler(sender, instance, created, **kwargs):
            _attachment_post_save(sender, instance, created, field_name, **kwargs)

        return handler

    def _make_delete_handler(field_name):
        def handler(sender, instance, **kwargs):
            _attachment_post_delete(sender, instance, field_name, **kwargs)

        return handler

    receiver(post_save, sender=_model_label)(_make_save_handler(_field_name))
    receiver(post_delete, sender=_model_label)(_make_delete_handler(_field_name))


# -- Image models (replaceable files: backup on every save, delete old on replace) --

IMAGE_MODELS = [
    ("users.User", "profile_picture"),
    ("houses.House", "profile_picture"),
    ("bookings.Room", "image"),
]

# Cache to track the old file name before save so we can delete it from S3 if replaced.
_old_file_cache: dict[str, str] = {}


def _image_pre_save(sender, instance, field_name, **kwargs):
    if not is_enabled() or not instance.pk:
        return
    try:
        old_instance = sender.objects.get(pk=instance.pk)
        old_file = getattr(old_instance, field_name, None)
        if old_file and old_file.name:
            cache_key = f"{sender.__name__}:{instance.pk}:{field_name}"
            _old_file_cache[cache_key] = old_file.name
    except sender.DoesNotExist:
        pass


def _image_post_save(sender, instance, field_name, **kwargs):
    if not is_enabled():
        return
    file_field = getattr(instance, field_name, None)
    new_name = file_field.name if file_field else ""

    # Delete old file from S3 if it was replaced
    cache_key = f"{sender.__name__}:{instance.pk}:{field_name}"
    old_name = _old_file_cache.pop(cache_key, "")
    if old_name and old_name != new_name:
        delete_file_from_s3_task(old_name)

    # Upload new file
    if new_name:
        backup_file_to_s3_task(new_name)


def _image_post_delete(sender, instance, field_name, **kwargs):
    if not is_enabled():
        return
    file_field = getattr(instance, field_name, None)
    if file_field and file_field.name:
        delete_file_from_s3_task(file_field.name)


for _model_label, _field_name in IMAGE_MODELS:

    def _make_pre_save_handler(field_name):
        def handler(sender, instance, **kwargs):
            _image_pre_save(sender, instance, field_name, **kwargs)

        return handler

    def _make_save_handler(field_name):
        def handler(sender, instance, **kwargs):
            _image_post_save(sender, instance, field_name, **kwargs)

        return handler

    def _make_delete_handler(field_name):
        def handler(sender, instance, **kwargs):
            _image_post_delete(sender, instance, field_name, **kwargs)

        return handler

    receiver(pre_save, sender=_model_label)(_make_pre_save_handler(_field_name))
    receiver(post_save, sender=_model_label)(_make_save_handler(_field_name))
    receiver(post_delete, sender=_model_label)(_make_delete_handler(_field_name))
