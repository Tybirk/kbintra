"""Service functions for the Events app."""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.utils import timezone

if TYPE_CHECKING:
    from apps.events.models import Event
    from apps.forum.models import Thread


def get_events_fallback_subgroup():
    """Catch-all subgroup (slug 'arrangementer') for community events that aren't
    assigned to a specific udvalg.

    The display name is 'Begivenheder'; the slug stays 'arrangementer' as a stable
    key referenced across the codebase (notifications, fixtures, etc.).
    """
    from apps.forum.models import Subgroup

    subgroup, _ = Subgroup.objects.get_or_create(
        slug="arrangementer",
        defaults={
            "name": "Begivenheder",
            "description": "Diskussioner om begivenheder",
        },
    )
    return subgroup


def create_event_thread(event: Event) -> Thread | None:
    """Create a forum discussion thread for a community event.

    Returns None for private events. For community events, creates a thread in
    event.subgroup if set, otherwise in the 'arrangementer' fallback subgroup.
    Does not trigger new-thread notifications — event creation notifications cover that.

    The thread starts empty; the event card itself serves as the OP slot and the
    UI renders an info banner where the first post would normally be.
    """
    from apps.events.models import Event as EventModel
    from apps.forum.models import Subgroup, Thread

    if event.visibility != EventModel.Visibility.COMMUNITY:
        return None

    if event.subgroup_id:
        subgroup = Subgroup.objects.get(id=event.subgroup_id)
    else:
        subgroup = get_events_fallback_subgroup()

    thread = Thread.objects.create(
        subgroup=subgroup,
        title=event.title,
        author=event.created_by,
    )

    subgroup.last_activity_at = timezone.now()
    subgroup.save(update_fields=["last_activity_at"])

    return thread


def sync_event_thread_subgroup(event: Event) -> None:
    """Re-parent an event's discussion thread to match the event's subgroup.

    When a community event is edited to (re)assign an udvalg, its existing thread
    must move with it; otherwise it stays under the previous group (e.g. the
    'Begivenheder' fallback) and isn't visible in the assigned udvalg.
    """
    from apps.events.models import Event as EventModel

    if event.visibility != EventModel.Visibility.COMMUNITY or not event.thread_id:
        return

    target = event.subgroup if event.subgroup_id else get_events_fallback_subgroup()

    if event.thread.subgroup_id != target.id:
        event.thread.subgroup = target
        event.thread.save(update_fields=["subgroup"])
        target.last_activity_at = timezone.now()
        target.save(update_fields=["last_activity_at"])


def free_folder_name(subgroup, parent, base: str, exclude_pk: int | None = None) -> str:
    """`base`, suffixed until it is unused among `parent`'s folders in `subgroup`.

    Folder's uniqueness is scoped to the subgroup, and event folders are named
    after their event — so two events called "Fællesspisning" collide, both when
    the second one's folder is created and when one is moved into a group that
    already has the name. Suffix rather than fail, mirroring the `-2` convention
    `Folder._generate_slug` already uses for slugs.
    """
    from apps.forum.models import Folder

    name = base
    n = 2
    while (
        Folder.objects.filter(subgroup=subgroup, parent=parent, name=name)
        .exclude(pk=exclude_pk)
        .exists()
    ):
        name = f"{base} ({n})"
        n += 1
    return name


def sync_event_folder_subgroup(event: Event) -> None:
    """Move an event's file folder along with the event's subgroup.

    The folder is created under whichever group the event had at upload time
    (often the 'Begivenheder' fallback, because files are usually attached before
    an udvalg is picked). Only moving the thread left the folder — and every file
    in it — behind in the old group, where the udvalg's members can't find them.

    Files carry their own subgroup FK for the group's file list, so they have to
    move too, not just their parent folder.
    """
    if not event.folder_id:
        return

    from apps.forum.models import File, Folder

    target = event.subgroup if event.subgroup_id else get_events_fallback_subgroup()
    folder = event.folder

    if folder.subgroup_id == target.id:
        return

    # Event folders live under a per-year folder; make sure the target group has
    # one rather than pointing at the old group's.
    year_folder, _ = Folder.objects.get_or_create(
        subgroup=target,
        name=str(event.start_datetime.year),
        parent=None,
    )
    folder.subgroup = target
    folder.parent = year_folder
    # Both of Folder's unique constraints are scoped to the subgroup, so carrying
    # the old name and slug into the target group can collide and raise. Re-derive
    # both against the target: the name gets a suffix if taken, and clearing the
    # slug makes Folder.save() regenerate it (it only generates when empty).
    folder.name = free_folder_name(target, year_folder, folder.name, exclude_pk=folder.pk)
    folder.slug = ""
    folder.save(update_fields=["subgroup", "parent", "name", "slug"])

    # Saved one by one rather than with a queryset .update(): .update() fires no
    # post_save, so the search index would keep pointing every one of these files
    # at the group they just left. Event folders hold a handful of files.
    for f in File.objects.filter(folder=folder):
        f.subgroup = target
        f.save(update_fields=["subgroup"])
