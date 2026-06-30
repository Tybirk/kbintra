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
