"""
Django signals to keep the FTS5 search index in sync with model changes.
"""

import json
import logging

from django.db.models.signals import m2m_changed, post_delete, post_save
from django.db.utils import OperationalError
from django.dispatch import receiver

from .services import _isoformat, create_excerpt, index_object, remove_object, strip_html

logger = logging.getLogger(__name__)


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


# -- Car signals --


@receiver(post_save, sender="houses.Car")
def index_car(sender, instance, **kwargs):
    try:
        subtitle_parts = [instance.house.name]
        if instance.is_electric:
            subtitle_parts.append("Elbil")
        index_object(
            obj_type="car",
            object_id=instance.id,
            title=instance.license_plate,
            body=instance.house.name,
            url=f"/beboere/hus/{instance.house_id}",
            subtitle=" · ".join(subtitle_parts),
            created_at=_isoformat(instance.created_at),
        )
    except OperationalError:
        logger.exception("Failed to index car %s", instance.id)


@receiver(post_delete, sender="houses.Car")
def deindex_car(sender, instance, **kwargs):
    try:
        remove_object("car", instance.id)
    except OperationalError:
        logger.exception("Failed to deindex car %s", instance.id)


# -- Thread signals --


@receiver(post_save, sender="forum.Thread")
def index_thread(sender, instance, **kwargs):
    try:
        first_post = instance.posts.order_by("created_at").first()
        index_object(
            obj_type="thread",
            object_id=instance.id,
            title=instance.title,
            body=strip_html(first_post.content) if first_post else "",
            url=f"/forum/{instance.subgroup.slug}/traad/{instance.slug}",
            subtitle=instance.subgroup.name,
            created_at=_isoformat(instance.created_at),
        )
        # Cascade: re-index all posts so they pick up the (possibly changed) thread title.
        # Skip on create (no posts yet) and when update_fields is set without "title".
        created = kwargs.get("created", False)
        update_fields = kwargs.get("update_fields")
        if not created and (update_fields is None or "title" in update_fields):
            for post in instance.posts.select_related("thread__subgroup").all():
                index_object(
                    obj_type="post",
                    object_id=post.id,
                    title=instance.title,
                    body=strip_html(post.content),
                    url=f"/forum/{instance.subgroup.slug}/traad/{instance.slug}",
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
        thread = instance.thread
        index_object(
            obj_type="post",
            object_id=instance.id,
            title=thread.title,
            body=strip_html(instance.content),
            url=f"/forum/{thread.subgroup.slug}/traad/{thread.slug}",
            subtitle=create_excerpt(instance.content, 80),
            extra=json.dumps({"thread_id": thread.id}),
            created_at=_isoformat(instance.created_at),
        )
        # If this is the first post, also update the thread's body so the thread
        # is findable by its opening content.
        first_post_id = thread.posts.order_by("created_at").values_list("id", flat=True).first()
        if first_post_id == instance.id:
            index_object(
                obj_type="thread",
                object_id=thread.id,
                title=thread.title,
                body=strip_html(instance.content),
                url=f"/forum/{thread.subgroup.slug}/traad/{thread.slug}",
                subtitle=thread.subgroup.name,
                created_at=_isoformat(thread.created_at),
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
            url=f"/opslag#announcement-{instance.id}",
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


def _index_event(instance) -> None:
    """Index a single event into the FTS table. Extracted so both post_save and
    m2m_changed can call it without duplicating logic."""
    date_str = instance.start_datetime.strftime("%d/%m/%Y %H:%M")
    location = instance.resolved_location
    subtitle = f"{date_str} – {location}" if location else date_str
    index_object(
        obj_type="event",
        object_id=instance.id,
        title=instance.title,
        body=" ".join(
            filter(
                None,
                [
                    strip_html(instance.description) if instance.description else "",
                    location,
                ],
            )
        ),
        url=f"/kalender/{instance.slug}",
        subtitle=subtitle,
        created_at=_isoformat(instance.created_at),
    )


@receiver(post_save, sender="events.Event")
def index_event(sender, instance, **kwargs):
    try:
        if instance.is_cancelled:
            remove_object("event", instance.id)
            return
        _index_event(instance)
    except OperationalError:
        logger.exception("Failed to index event %s", instance.id)


@receiver(m2m_changed, sender="events.Event_rooms")
def index_event_on_rooms_change(sender, instance, action, **kwargs):
    """Re-index the event after rooms are added/removed so room names appear in search."""
    if action not in ("post_add", "post_remove", "post_clear"):
        return
    try:
        if instance.is_cancelled:
            return
        _index_event(instance)
    except OperationalError:
        logger.exception("Failed to re-index event %s after rooms change", instance.id)


@receiver(post_delete, sender="events.Event")
def deindex_event(sender, instance, **kwargs):
    try:
        remove_object("event", instance.id)
    except OperationalError:
        logger.exception("Failed to deindex event %s", instance.id)


# -- File signals --


@receiver(post_save, sender="forum.File")
def index_file(sender, instance, **kwargs):
    try:
        # Files without a subgroup are event attachments — skip search indexing
        if not instance.subgroup_id:
            return
        try:
            file_url = instance.file.url
        except ValueError:
            file_url = ""
        index_object(
            obj_type="file",
            object_id=instance.id,
            title=instance.name,
            body="",
            url=f"/forum/{instance.subgroup.slug}",
            subtitle=instance.subgroup.name,
            extra=json.dumps({"file_url": file_url}) if file_url else "",
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
