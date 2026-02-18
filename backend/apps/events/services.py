"""Service functions for the Events app."""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.utils import timezone

if TYPE_CHECKING:
    from apps.events.models import Event
    from apps.forum.models import Thread


def create_event_thread(event: Event) -> Thread | None:
    """Create a forum discussion thread for a community event.

    Returns None for private events. For community events, creates a thread in
    event.subgroup if set, otherwise in the 'arrangementer' fallback subgroup.
    Does not trigger new-thread notifications — event creation notifications cover that.
    """
    from apps.events.models import Event as EventModel
    from apps.forum.models import Post, Subgroup, Thread

    if event.visibility != EventModel.Visibility.COMMUNITY:
        return None

    if event.subgroup_id:
        subgroup = Subgroup.objects.get(id=event.subgroup_id)
    else:
        subgroup, _ = Subgroup.objects.get_or_create(
            slug="arrangementer",
            defaults={
                "name": "Arrangementer",
                "description": "Diskussioner om arrangementer",
            },
        )

    thread = Thread.objects.create(
        subgroup=subgroup,
        title=event.title,
        author=event.created_by,
    )

    Post.objects.create(
        thread=thread,
        author=event.created_by,
        content="<p>Brug denne tråd til at diskutere arrangementet.</p>",
    )

    subgroup.last_activity_at = timezone.now()
    subgroup.save(update_fields=["last_activity_at"])

    return thread
