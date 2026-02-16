"""
Django signals to keep the FTS5 search index in sync with model changes.
"""

import json
import logging

from django.db.models.signals import post_delete, post_save
from django.db.utils import OperationalError
from django.dispatch import receiver

from .services import create_excerpt, index_object, remove_object, strip_html

logger = logging.getLogger(__name__)


def _isoformat(dt) -> str:
    """Convert a datetime to ISO string, or empty string if None."""
    return dt.isoformat() if dt else ""


# -- User signals --


@receiver(post_save, sender="users.User")
def index_user(sender, instance, **kwargs):
    try:
        if not instance.is_active:
            remove_object("user", instance.id)
            return
        index_object(
            obj_type="user",
            object_id=instance.id,
            title=instance.get_full_name() or instance.email,
            body=instance.email,
            url=f"/profil/{instance.id}",
            subtitle=instance.house.name if instance.house_id else "",
            created_at=_isoformat(instance.date_joined),
        )
    except OperationalError:
        logger.exception("Failed to index user %s", instance.id)


@receiver(post_delete, sender="users.User")
def deindex_user(sender, instance, **kwargs):
    try:
        remove_object("user", instance.id)
    except OperationalError:
        logger.exception("Failed to deindex user %s", instance.id)


# -- House signals --


@receiver(post_save, sender="houses.House")
def index_house(sender, instance, **kwargs):
    try:
        index_object(
            obj_type="house",
            object_id=instance.id,
            title=instance.name,
            body=strip_html(instance.description) if instance.description else "",
            url=f"/beboere/hus/{instance.id}",
            subtitle=create_excerpt(instance.description, 80) if instance.description else "",
            created_at=_isoformat(instance.created_at),
        )
    except OperationalError:
        logger.exception("Failed to index house %s", instance.id)


@receiver(post_delete, sender="houses.House")
def deindex_house(sender, instance, **kwargs):
    try:
        remove_object("house", instance.id)
    except OperationalError:
        logger.exception("Failed to deindex house %s", instance.id)


# -- Thread signals --


@receiver(post_save, sender="forum.Thread")
def index_thread(sender, instance, **kwargs):
    try:
        index_object(
            obj_type="thread",
            object_id=instance.id,
            title=instance.title,
            body="",
            url=f"/forum/{instance.subgroup.slug}/{instance.id}",
            subtitle=instance.subgroup.name,
            created_at=_isoformat(instance.created_at),
        )
        # Cascade: re-index all posts so they pick up the (possibly changed) thread title
        for post in instance.posts.select_related("thread__subgroup").all():
            index_object(
                obj_type="post",
                object_id=post.id,
                title=instance.title,
                body=strip_html(post.content),
                url=f"/forum/{instance.subgroup.slug}/{instance.id}",
                subtitle=create_excerpt(post.content, 80),
                extra=json.dumps({"thread_id": instance.id}),
                created_at=_isoformat(post.created_at),
            )
    except OperationalError:
        logger.exception("Failed to index thread %s", instance.id)


@receiver(post_delete, sender="forum.Thread")
def deindex_thread(sender, instance, **kwargs):
    try:
        remove_object("thread", instance.id)
    except OperationalError:
        logger.exception("Failed to deindex thread %s", instance.id)


# -- Post signals --


@receiver(post_save, sender="forum.Post")
def index_post(sender, instance, **kwargs):
    try:
        index_object(
            obj_type="post",
            object_id=instance.id,
            title=instance.thread.title,
            body=strip_html(instance.content),
            url=f"/forum/{instance.thread.subgroup.slug}/{instance.thread.id}",
            subtitle=create_excerpt(instance.content, 80),
            extra=json.dumps({"thread_id": instance.thread.id}),
            created_at=_isoformat(instance.created_at),
        )
    except OperationalError:
        logger.exception("Failed to index post %s", instance.id)


@receiver(post_delete, sender="forum.Post")
def deindex_post(sender, instance, **kwargs):
    try:
        remove_object("post", instance.id)
    except OperationalError:
        logger.exception("Failed to deindex post %s", instance.id)


# -- Subgroup signals --


@receiver(post_save, sender="forum.Subgroup")
def index_subgroup(sender, instance, **kwargs):
    try:
        index_object(
            obj_type="subgroup",
            object_id=instance.id,
            title=instance.name,
            body=strip_html(instance.description) if instance.description else "",
            url=f"/forum/{instance.slug}",
            subtitle=create_excerpt(instance.description, 80) if instance.description else "",
            created_at=_isoformat(instance.created_at),
        )
    except OperationalError:
        logger.exception("Failed to index subgroup %s", instance.id)


@receiver(post_delete, sender="forum.Subgroup")
def deindex_subgroup(sender, instance, **kwargs):
    try:
        remove_object("subgroup", instance.id)
    except OperationalError:
        logger.exception("Failed to deindex subgroup %s", instance.id)


# -- Announcement signals --


@receiver(post_save, sender="announcements.Announcement")
def index_announcement(sender, instance, **kwargs):
    try:
        if not instance.is_active:
            remove_object("announcement", instance.id)
            return
        index_object(
            obj_type="announcement",
            object_id=instance.id,
            title=instance.title,
            body=strip_html(instance.content),
            url="/opslag",
            subtitle=create_excerpt(instance.content, 80),
            created_at=_isoformat(instance.created_at),
        )
    except OperationalError:
        logger.exception("Failed to index announcement %s", instance.id)


@receiver(post_delete, sender="announcements.Announcement")
def deindex_announcement(sender, instance, **kwargs):
    try:
        remove_object("announcement", instance.id)
    except OperationalError:
        logger.exception("Failed to deindex announcement %s", instance.id)


# -- Event signals --


@receiver(post_save, sender="calendar_app.Event")
def index_event(sender, instance, **kwargs):
    try:
        index_object(
            obj_type="event",
            object_id=instance.id,
            title=instance.title,
            body=" ".join(
                filter(
                    None,
                    [
                        strip_html(instance.description) if instance.description else "",
                        instance.location or "",
                    ],
                )
            ),
            url="/kalender",
            subtitle=instance.location or create_excerpt(instance.description, 80),
            created_at=_isoformat(instance.created_at),
        )
    except OperationalError:
        logger.exception("Failed to index event %s", instance.id)


@receiver(post_delete, sender="calendar_app.Event")
def deindex_event(sender, instance, **kwargs):
    try:
        remove_object("event", instance.id)
    except OperationalError:
        logger.exception("Failed to deindex event %s", instance.id)


# -- File signals --


@receiver(post_save, sender="forum.File")
def index_file(sender, instance, **kwargs):
    try:
        index_object(
            obj_type="file",
            object_id=instance.id,
            title=instance.name,
            body="",
            url=f"/forum/{instance.subgroup.slug}",
            subtitle=instance.subgroup.name,
            extra=json.dumps({"file_url": instance.file.url}),
            created_at=_isoformat(instance.uploaded_at),
        )
    except OperationalError:
        logger.exception("Failed to index file %s", instance.id)


@receiver(post_delete, sender="forum.File")
def deindex_file(sender, instance, **kwargs):
    try:
        remove_object("file", instance.id)
    except OperationalError:
        logger.exception("Failed to deindex file %s", instance.id)
