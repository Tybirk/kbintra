"""
Forum services: shared logic for membership, subscriptions, and content visibility.

These helpers centralize rules so views, signals, and notification tasks all agree.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.db.models import Q

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


def remove_member(subgroup: Subgroup, user: User) -> bool:
    """Remove a membership. Does NOT delete the subscription."""
    deleted, _ = SubgroupMembership.objects.filter(user=user, subgroup=subgroup).delete()
    return bool(deleted)


# ---------------------------------------------------------------------------
# Visibility
# ---------------------------------------------------------------------------


def member_subgroup_ids(user: User) -> set[int]:
    """Return the set of subgroup IDs the user is a member of."""
    if not user or not user.is_authenticated:
        return set()
    return set(SubgroupMembership.objects.filter(user=user).values_list("subgroup_id", flat=True))


def can_view_thread(user: User, thread: Thread) -> bool:
    """Whether the user can see a given thread.

    Public threads: always visible.
    Private threads: visible to (a) members of the subgroup, (b) the author.
    is_staff has NO bypass — admins must be members to view private content.
    """
    if not thread.members_only:
        return True
    if not user or not user.is_authenticated:
        return False
    if thread.author_id == user.id:
        return True
    return SubgroupMembership.objects.filter(user=user, subgroup_id=thread.subgroup_id).exists()


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
    """Whether the user can see a given file.

    Public files: always visible.
    Private files: visible to (a) members of the file's subgroup, (b) the uploader.
    """
    if not file.members_only:
        return True
    if not user or not user.is_authenticated:
        return False
    if file.uploaded_by_id == user.id:
        return True
    if file.subgroup_id is None:
        return True
    return SubgroupMembership.objects.filter(user=user, subgroup_id=file.subgroup_id).exists()


def visible_threads_q(user: User) -> Q:
    """A Q filter that returns only threads the user is allowed to see."""
    if not user or not user.is_authenticated:
        return Q(members_only=False)
    member_ids = member_subgroup_ids(user)
    return Q(members_only=False) | Q(subgroup_id__in=member_ids) | Q(author=user)


def visible_files_q(user: User) -> Q:
    """A Q filter that returns only files the user is allowed to see."""
    if not user or not user.is_authenticated:
        return Q(members_only=False)
    member_ids = member_subgroup_ids(user)
    return Q(members_only=False) | Q(subgroup_id__in=member_ids) | Q(uploaded_by=user)


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
