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
    Subgroup,
    SubgroupMembership,
    SubgroupSubscription,
    Thread,
)

if TYPE_CHECKING:
    from django.db.models import QuerySet

    from apps.users.models import User


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
