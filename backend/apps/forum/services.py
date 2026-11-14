"""
Forum services: shared logic for membership, subscriptions, and content visibility.

These helpers centralize rules so views, signals, and notification tasks all agree.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from typing import TYPE_CHECKING

from django.db.models import Q
from django.http import Http404
from django.shortcuts import get_object_or_404

from .models import (
    File,
    Folder,
    Poll,
    PollOption,
    Subgroup,
    SubgroupMembership,
    SubgroupSubscription,
    Thread,
)

if TYPE_CHECKING:
    from django.db.models import QuerySet

    from apps.messaging.models import Message
    from apps.users.models import User

    from .models import Post


# ---------------------------------------------------------------------------
# Membership ⇄ subscription
# ---------------------------------------------------------------------------


def add_member(subgroup: Subgroup, user: User, role: str = "Medlem") -> SubgroupMembership:
    """Create a membership and ensure a subscription exists.

    Membership implies subscription — adding a member auto-creates a subscription
    if none exists. Idempotent.
    """
    membership, _created = SubgroupMembership.objects.get_or_create(
        user=user,
        subgroup=subgroup,
        defaults={"role": role},
    )
    SubgroupSubscription.objects.get_or_create(user=user, subgroup=subgroup)
    return membership


def remove_member(subgroup: Subgroup, user_id: int) -> bool:
    """Remove a membership. Does NOT delete the subscription — except in a secret
    group, where it would keep the group's name in the leaver's list of groups they
    follow, and so on their screen after they lost the right to see it."""
    deleted, _ = SubgroupMembership.objects.filter(user_id=user_id, subgroup=subgroup).delete()
    if deleted and subgroup.is_secret:
        SubgroupSubscription.objects.filter(user_id=user_id, subgroup=subgroup).delete()
    return bool(deleted)


def is_last_secret_member(subgroup: Subgroup, user_id: int) -> bool:
    """Whether removing this member would leave a secret group with nobody at all —
    and so nobody who could see it, add anyone or delete it again."""
    if not subgroup.is_secret:
        return False
    members = SubgroupMembership.objects.filter(subgroup=subgroup)
    return members.filter(user_id=user_id).exists() and members.count() == 1


# ---------------------------------------------------------------------------
# Visibility
#
# One rule, in three shapes: can_view_thread for one user and one thread,
# visible_threads_q as a filter for one user and many threads, and
# thread_viewer_ids for one thread and many users (who may be told about it).
#
#   A member of the thread's group sees everything in it. Outside a secret
#   group, everybody sees the public threads, and the author also sees their
#   own private one. In a secret group nobody else sees anything — not even an
#   author who has since left.
#
# Files follow the same rule with the uploader in the author's place.
# is_staff has NO bypass — admins must be members to view private content.
# ---------------------------------------------------------------------------


def member_subgroup_ids(user: User) -> set[int]:
    """Return the set of subgroup IDs the user is a member of."""
    if not user or not user.is_authenticated:
        return set()
    return set(SubgroupMembership.objects.filter(user=user).values_list("subgroup_id", flat=True))


def get_visible_subgroup_or_404(user: User, slug: str) -> Subgroup:
    """The group with this slug, unless it is secret and `user` isn't a member: then
    404, the same answer as for a group that doesn't exist."""
    return get_object_or_404(Subgroup.objects.visible_to(user), slug=slug)


def can_view_thread(user: User, thread: Thread) -> bool:
    """Whether the user can see a given thread (the rule is above)."""
    if not thread.members_only and not thread.subgroup.is_secret:
        return True
    if not user or not user.is_authenticated:
        return False
    if SubgroupMembership.objects.filter(user=user, subgroup_id=thread.subgroup_id).exists():
        return True
    return thread.author_id == user.id and not thread.subgroup.is_secret


def thread_viewer_ids(thread: Thread, user_ids: Iterable[int | None]) -> set[int]:
    """Which of `user_ids` can see `thread` — for deciding who may be notified
    about it, since a notification carries its title and often its text."""
    ids = {uid for uid in user_ids if uid is not None}
    if not ids:
        return set()
    if not thread.members_only and not thread.subgroup.is_secret:
        return ids
    members = set(
        SubgroupMembership.objects.filter(
            subgroup_id=thread.subgroup_id, user_id__in=ids
        ).values_list("user_id", flat=True)
    )
    if thread.author_id in ids and not thread.subgroup.is_secret:
        members.add(thread.author_id)
    return members


def can_view_poll(user: User, poll: Poll) -> bool:
    """Whether the user can see a poll, and so vote in it.

    A poll in the forum follows its thread (see can_view_thread); a poll in a chat
    is for the conversation's participants only.
    """
    if not user or not user.is_authenticated:
        return False
    if poll.message_id is not None:
        return poll.message.conversation.participants.filter(id=user.id).exists()
    return can_view_thread(user, poll.post.thread)


def can_view_file(user: User, file: File) -> bool:
    """Whether the user can see a given file (the rule is above). A private file
    outside any group is visible to everybody, as it always was."""
    if file.subgroup_id is None or (not file.members_only and not file.subgroup.is_secret):
        return True
    if not user or not user.is_authenticated:
        return False
    if SubgroupMembership.objects.filter(user=user, subgroup_id=file.subgroup_id).exists():
        return True
    return file.uploaded_by_id == user.id and not file.subgroup.is_secret


def _prefixed(prefix: str) -> Callable[..., Q]:
    """Q() with every lookup under `prefix`, so a rule written for threads can
    filter the posts or attachments that hang off them."""
    return lambda **lookups: Q(**{prefix + key: value for key, value in lookups.items()})


def visible_threads_q(user: User, prefix: str = "") -> Q:
    """Threads the user may see (the rule is above), as a filter. Pass e.g.
    prefix="thread__" to filter posts by their thread."""
    q = _prefixed(prefix)
    if not user or not user.is_authenticated:
        return q(members_only=False, subgroup__is_secret=False)
    return q(subgroup_id__in=member_subgroup_ids(user)) | (
        q(subgroup__is_secret=False) & (q(members_only=False) | q(author=user))
    )


def visible_files_q(user: User) -> Q:
    """Files the user may see (the rule is above), as a filter."""
    not_secret = Q(subgroup__isnull=True) | Q(subgroup__is_secret=False)
    if not user or not user.is_authenticated:
        return not_secret & Q(members_only=False)
    return Q(subgroup_id__in=member_subgroup_ids(user)) | (
        not_secret & (Q(members_only=False) | Q(uploaded_by=user))
    )


def filter_visible_threads(qs: QuerySet[Thread], user: User) -> QuerySet[Thread]:
    return qs.filter(visible_threads_q(user))


def filter_visible_files(qs: QuerySet[File], user: User) -> QuerySet[File]:
    return qs.filter(visible_files_q(user))


def folder_subtree_ids(folder: Folder) -> set[int]:
    """Return the folder's own ID plus all descendant folder IDs."""
    ids: set[int] = {folder.id}
    frontier = [folder.id]
    while frontier:
        children = list(Folder.objects.filter(parent_id__in=frontier).values_list("id", flat=True))
        new = [c for c in children if c not in ids]
        ids.update(new)
        frontier = new
    return ids


def visible_folder_ids(user: User, subgroup: Subgroup) -> set[int]:
    """Return folder IDs in `subgroup` that `user` is allowed to see.

    Users with the right to see the full directory structure (formal members,
    or any authenticated user when the subgroup does not enforce privacy) see
    every folder, including empty ones — otherwise a freshly created folder
    would be invisible to its creator until a file is uploaded to it.

    Otherwise, a folder is shown only if it (or any descendant) contains a
    file the user can view, so the directory structure itself does not leak
    the existence of private content.
    """
    sees_all = (
        user
        and user.is_authenticated
        and (
            not subgroup.allows_members
            or SubgroupMembership.objects.filter(user=user, subgroup=subgroup).exists()
        )
    )
    if sees_all:
        return set(Folder.objects.filter(subgroup=subgroup).values_list("id", flat=True))

    file_folder_ids = set(
        File.objects.filter(visible_files_q(user), subgroup=subgroup)
        .exclude(folder__isnull=True)
        .values_list("folder_id", flat=True)
        .distinct()
    )

    if not file_folder_ids:
        return set()

    parent_map = dict(Folder.objects.filter(subgroup=subgroup).values_list("id", "parent_id"))

    visible: set[int] = set()
    for fid in file_folder_ids:
        cur: int | None = fid
        while cur is not None and cur not in visible:
            visible.add(cur)
            cur = parent_map.get(cur)
    return visible


def get_visible_folder_or_404(user: User, pk: int) -> Folder:
    """The folder, if `user` can see it (see visible_folder_ids); otherwise 404, so
    a guessed id says nothing about a group the user can't see."""
    folder = get_object_or_404(Folder.objects.select_related("subgroup"), pk=pk)
    if folder.subgroup is not None and folder.id not in visible_folder_ids(user, folder.subgroup):
        raise Http404
    return folder


# ---------------------------------------------------------------------------
# Polls — one model for the forum and the chat
# ---------------------------------------------------------------------------


def create_poll(
    data: dict,
    created_by: User,
    *,
    post: Post | None = None,
    message: Message | None = None,
) -> Poll:
    """Create a poll and its options from validated `poll_data` (PollDataField),
    in a forum post or in a chat message."""
    poll = Poll.objects.create(
        post=post,
        message=message,
        question=data["question"],
        allow_multiple_votes=data["allow_multiple_votes"],
        is_anonymous=data["is_anonymous"],
        allow_others_to_add_options=data["allow_others_to_add_options"],
        created_by=created_by,
    )
    PollOption.objects.bulk_create(
        PollOption(poll=poll, text=option["text"], order=i)
        for i, option in enumerate(data["options"])
    )
    return poll


def broadcast_poll_update(poll: Poll) -> None:
    """Tell an open chat that a poll in it changed (a vote, a new option, an edit).

    Only the poll's id travels: each socket re-reads the poll for its own user,
    so `has_voted` and `is_own` are right for everyone and an anonymous poll never
    sends anyone the voters. A forum poll needs nothing — the thread refetches.
    """
    if poll.message_id is None:
        return

    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer

    conversation_id = poll.message.conversation_id
    async_to_sync(get_channel_layer().group_send)(
        f"conversation_{conversation_id}",
        {
            "type": "poll_updated",
            "poll_id": poll.id,
            "message_id": poll.message_id,
            "conversation_id": conversation_id,
        },
    )
