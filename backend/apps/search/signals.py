"""
Django signals to keep the FTS5 search index in sync with model changes.

What goes into a row is decided in `documents.py`, which `rebuild_search_index`
uses too; the receivers here only decide when.
"""

import logging

from django.db.models.signals import m2m_changed, post_delete, post_save
from django.db.utils import OperationalError
from django.dispatch import receiver

from .documents import (
    announcement_document,
    car_document,
    event_document,
    file_document,
    folder_document,
    house_document,
    post_document,
    report_document,
    subgroup_document,
    thread_document,
    user_document,
)
from .services import index_object, remove_object, retitle_thread_posts, set_subtitle

logger = logging.getLogger(__name__)


def _sync(obj_type: str, object_id: int, document: dict | None) -> None:
    """Write the object's row, or remove it when it shouldn't be searchable."""
    if document is None:
        remove_object(obj_type, object_id)
    else:
        index_object(**document)


def _deindex(obj_type: str, object_id: int) -> None:
    try:
        remove_object(obj_type, object_id)
    except OperationalError:
        logger.exception("Failed to deindex %s %s", obj_type, object_id)


# -- Users, houses, cars --


@receiver(post_save, sender="users.User")
def index_user(sender, instance, **kwargs):
    try:
        _sync("user", instance.id, user_document(instance))
    except OperationalError:
        logger.exception("Failed to index user %s", instance.id)


@receiver(post_delete, sender="users.User")
def deindex_user(sender, instance, **kwargs):
    _deindex("user", instance.id)


@receiver(post_save, sender="houses.House")
def index_house(sender, instance, **kwargs):
    try:
        _sync("house", instance.id, house_document(instance))
    except OperationalError:
        logger.exception("Failed to index house %s", instance.id)


@receiver(post_delete, sender="houses.House")
def deindex_house(sender, instance, **kwargs):
    _deindex("house", instance.id)


@receiver(post_save, sender="houses.Car")
def index_car(sender, instance, **kwargs):
    try:
        _sync("car", instance.id, car_document(instance))
    except OperationalError:
        logger.exception("Failed to index car %s", instance.id)


@receiver(post_delete, sender="houses.Car")
def deindex_car(sender, instance, **kwargs):
    _deindex("car", instance.id)


# -- Threads and posts --


@receiver(post_save, sender="forum.Thread")
def index_thread(sender, instance, **kwargs):
    try:
        _sync("thread", instance.id, thread_document(instance))
        # A rename or a move reaches the post rows too: their title is the thread's,
        # and their URL the thread's plus their own #post-<id>. One UPDATE, no
        # re-indexing post by post. Skipped on create (no posts yet) and when
        # update_fields excludes both "title" and "subgroup".
        created = kwargs.get("created", False)
        update_fields = kwargs.get("update_fields")
        if not created and (
            update_fields is None or "title" in update_fields or "subgroup" in update_fields
        ):
            retitle_thread_posts(
                instance.id,
                instance.title,
                f"/forum/{instance.subgroup.slug}/traad/{instance.slug}",
            )
    except OperationalError:
        logger.exception("Failed to index thread %s", instance.id)


@receiver(post_delete, sender="forum.Thread")
def deindex_thread(sender, instance, **kwargs):
    _deindex("thread", instance.id)


@receiver(post_save, sender="forum.Post")
def index_post(sender, instance, **kwargs):
    try:
        _sync("post", instance.id, post_document(instance))
        # The thread's row carries its opening post: refresh it when that is this one.
        thread = instance.thread
        first_post_id = thread.posts.order_by("created_at").values_list("id", flat=True).first()
        if first_post_id == instance.id:
            _sync("thread", thread.id, thread_document(thread))
    except OperationalError:
        logger.exception("Failed to index post %s", instance.id)


@receiver(post_delete, sender="forum.Post")
def deindex_post(sender, instance, **kwargs):
    _deindex("post", instance.id)


# -- Groups --


@receiver(post_save, sender="forum.Subgroup")
def index_subgroup(sender, instance, **kwargs):
    try:
        _sync("subgroup", instance.id, subgroup_document(instance))

        # Cascade: the group's threads, files and folders all carry its name as
        # their subtitle, and index rows are only rewritten when their own object
        # is saved — so without this a rename leaves every one of them showing
        # the old name until something else happens to touch it.
        #
        # Only the subtitle, never a full re-index: that took 68.7 s for Fælles
        # and made every "Gem" on a group time out. Nothing else on those rows
        # depends on the group — its slug, and so their URLs, never changes on
        # a rename — and post rows do not mention the group at all.
        #
        # Skipped for the `last_activity_at` bumps that run on every new thread
        # and post, since those pass update_fields and can't have changed a name.
        update_fields = kwargs.get("update_fields")
        if update_fields is not None and "name" not in update_fields:
            return
        if kwargs.get("created", False):
            return
        for obj_type, related in (
            ("thread", instance.threads),
            ("folder", instance.folders),
            ("file", instance.files),
        ):
            set_subtitle(obj_type, list(related.values_list("id", flat=True)), instance.name)
    except OperationalError:
        logger.exception("Failed to index subgroup %s", instance.id)


@receiver(post_delete, sender="forum.Subgroup")
def deindex_subgroup(sender, instance, **kwargs):
    _deindex("subgroup", instance.id)


# -- Announcements and events --


@receiver(post_save, sender="announcements.Announcement")
def index_announcement(sender, instance, **kwargs):
    try:
        _sync("announcement", instance.id, announcement_document(instance))
    except OperationalError:
        logger.exception("Failed to index announcement %s", instance.id)


@receiver(post_delete, sender="announcements.Announcement")
def deindex_announcement(sender, instance, **kwargs):
    _deindex("announcement", instance.id)


@receiver(post_save, sender="events.Event")
def index_event(sender, instance, **kwargs):
    try:
        _sync("event", instance.id, event_document(instance))
    except OperationalError:
        logger.exception("Failed to index event %s", instance.id)


@receiver(m2m_changed, sender="events.Event_rooms")
def index_event_on_rooms_change(sender, instance, action, **kwargs):
    """Re-index the event after rooms are added/removed so room names appear in search."""
    if action not in ("post_add", "post_remove", "post_clear"):
        return
    try:
        _sync("event", instance.id, event_document(instance))
    except OperationalError:
        logger.exception("Failed to re-index event %s after rooms change", instance.id)


@receiver(post_delete, sender="events.Event")
def deindex_event(sender, instance, **kwargs):
    _deindex("event", instance.id)


# -- Files and folders --


@receiver(post_save, sender="forum.File")
def index_file(sender, instance, **kwargs):
    try:
        _sync("file", instance.id, file_document(instance))
    except OperationalError:
        logger.exception("Failed to index file %s", instance.id)


@receiver(post_delete, sender="forum.File")
def deindex_file(sender, instance, **kwargs):
    _deindex("file", instance.id)


@receiver(post_save, sender="forum.Folder")
def index_folder(sender, instance, **kwargs):
    try:
        _sync("folder", instance.id, folder_document(instance))
    except OperationalError:
        logger.exception("Failed to index folder %s", instance.id)


@receiver(post_delete, sender="forum.Folder")
def deindex_folder(sender, instance, **kwargs):
    _deindex("folder", instance.id)


# -- Reports (indrapportering) --


@receiver(post_save, sender="reports.Report")
def index_report(sender, instance, **kwargs):
    try:
        _sync("report", instance.id, report_document(instance))
    except OperationalError:
        logger.exception("Failed to index report %s", instance.id)


@receiver(post_delete, sender="reports.Report")
def deindex_report(sender, instance, **kwargs):
    _deindex("report", instance.id)


@receiver(post_save, sender="users.User")
def reindex_reports_for_user(sender, instance, **kwargs):
    """Re-index a resident's cases when they change.

    The reporter's name is denormalised into each case's index row — the price
    of letting the queue search names through the index — so a rename would
    otherwise leave the old name searchable and the new one missing.

    Unconditional rather than checking whether the name actually changed: a
    resident has a handful of cases, this is that many FTS row rewrites, and
    the alternative is keeping a copy of the old name around to compare against.
    """
    from apps.reports.models import Report

    try:
        reports = Report.objects.filter(submitted_by=instance).select_related(
            "subgroup", "submitted_by"
        )
        for report in reports:
            index_object(**report_document(report))
    except OperationalError:
        logger.exception("Failed to re-index reports for user %s", instance.id)
