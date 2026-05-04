"""
Views for Forum models.
"""

import io
import zipfile
from typing import Any

from django.db.models import Count, F, Max, OuterRef, Prefetch, Q, Subquery
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    File,
    Folder,
    Poll,
    PollOption,
    PollVote,
    Post,
    Reaction,
    Subgroup,
    SubgroupMembership,
    SubgroupRoleOption,
    SubgroupSubscription,
    Thread,
    ThreadMuteStatus,
    ThreadReadStatus,
)
from .serializers import (
    FilePartialUpdateSerializer,
    FileSerializer,
    FileUploadSerializer,
    FolderCreateSerializer,
    FolderSerializer,
    PollSerializer,
    PollUpdateSerializer,
    PostCreateSerializer,
    PostSerializer,
    RecentActivitySerializer,
    SubgroupCreateSerializer,
    SubgroupMembershipSerializer,
    SubgroupSerializer,
    SubgroupSubscriptionSerializer,
    SubgroupUpdateSerializer,
    ThreadCreateSerializer,
    ThreadDetailSerializer,
    ThreadSerializer,
    ThreadUpdateSerializer,
)
from .services import (
    add_member,
    can_view_file,
    can_view_thread,
    filter_visible_files,
    filter_visible_threads,
    folder_subtree_ids,
    member_subgroup_ids,
    remove_member,
    visible_folder_ids,
    visible_threads_q,
)


class IsOwnerOrReadOnly(permissions.BasePermission):
    """Custom permission to only allow owners to edit/delete."""

    def has_object_permission(self, request: Request, view: Any, obj: Any) -> bool:
        if request.method in permissions.SAFE_METHODS:
            return True
        # Check for author or uploaded_by attribute
        if hasattr(obj, "author"):
            return obj.author == request.user
        if hasattr(obj, "uploaded_by"):
            return obj.uploaded_by == request.user
        return False


class IsOwnerOrAdmin(permissions.BasePermission):
    """Permission to only allow owners or admins to perform action."""

    def has_object_permission(self, request: Request, view: Any, obj: Any) -> bool:
        # Admin can do anything
        if request.user.is_staff:
            return True
        # Check for author attribute (for threads/posts)
        if hasattr(obj, "author"):
            return obj.author == request.user
        # Check for uploaded_by attribute (for files)
        if hasattr(obj, "uploaded_by"):
            return obj.uploaded_by == request.user
        return False


def _is_member(user: Any, subgroup: Subgroup) -> bool:
    if not user or not user.is_authenticated:
        return False
    return SubgroupMembership.objects.filter(user=user, subgroup=subgroup).exists()


class IsMemberOrAdmin(permissions.BasePermission):
    """Permission for users who are either staff or members of a given subgroup.

    The subgroup is resolved via the URL kwarg `slug`.
    """

    def has_permission(self, request: Request, view: Any) -> bool:
        if not request.user or not request.user.is_authenticated:
            return False
        if request.user.is_staff:
            return True
        slug = view.kwargs.get("slug")
        if not slug:
            return False
        subgroup = Subgroup.objects.filter(slug=slug).first()
        if subgroup is None:
            return False
        return SubgroupMembership.objects.filter(user=request.user, subgroup=subgroup).exists()


# Subgroup Views
def _subgroup_list_queryset() -> Any:
    """Queryset for subgroup list/detail views with prefetched threads and members.

    Threads are filtered to non-closed only with just the columns SubgroupSerializer
    actually consults (id, members_only, author_id, updated_at, title) — closed
    threads aren't needed by any serializer field.

    Memberships are prefetched (with user + house joined) so SubgroupSerializer.get_members
    doesn't run a query per subgroup.
    """
    return Subgroup.objects.prefetch_related(
        Prefetch(
            "threads",
            queryset=Thread.objects.filter(is_closed=False).only(
                "id", "subgroup_id", "members_only", "author_id", "updated_at", "title", "is_closed"
            ),
        ),
        Prefetch(
            "memberships",
            queryset=SubgroupMembership.objects.select_related("user", "user__house").order_by(
                "user__first_name", "user__last_name"
            ),
        ),
    ).all()


class SubgroupListView(generics.ListCreateAPIView):
    """List all subgroups or create a new one."""

    permission_classes = [permissions.IsAuthenticated]
    queryset = _subgroup_list_queryset()

    def get_serializer_class(self) -> type:
        if self.request.method == "POST":
            return SubgroupCreateSerializer
        return SubgroupSerializer

    def get_serializer_context(self) -> dict:
        context = super().get_serializer_context()
        user = self.request.user
        if user.is_authenticated:
            statuses = ThreadReadStatus.objects.filter(user=user).values_list(
                "thread_id", "last_read_at"
            )
            context["read_status_map"] = dict(statuses)
            context["subscribed_subgroup_ids"] = set(
                SubgroupSubscription.objects.filter(user=user).values_list("subgroup_id", flat=True)
            )
            context["member_subgroup_ids"] = set(member_subgroup_ids(user))
        return context

    def create(self, request: Request, *args: object, **kwargs: object) -> Response:
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        subgroup = serializer.save()
        # If the new group allows members, auto-enroll the creator (and subscribe).
        if subgroup.allows_members:
            add_member(subgroup, request.user)
        out = SubgroupSerializer(subgroup, context=self.get_serializer_context())
        return Response(out.data, status=status.HTTP_201_CREATED)


class SubgroupDetailView(generics.RetrieveAPIView):
    """Get subgroup details."""

    serializer_class = SubgroupSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = _subgroup_list_queryset()
    lookup_field = "slug"

    def get_serializer_context(self) -> dict:
        context = super().get_serializer_context()
        user = self.request.user
        if user.is_authenticated:
            context["subscribed_subgroup_ids"] = set(
                SubgroupSubscription.objects.filter(user=user).values_list("subgroup_id", flat=True)
            )
            context["member_subgroup_ids"] = set(member_subgroup_ids(user))
            # Powers subgroup.unread_thread_count on the detail endpoint so the
            # frontend doesn't have to load every thread to know if the tab dot
            # should show.
            context["read_status_map"] = dict(
                ThreadReadStatus.objects.filter(user=user).values_list("thread_id", "last_read_at")
            )
        return context


class SubscribeView(APIView):
    """Subscribe to a subgroup."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, slug: str) -> Response:
        subgroup = get_object_or_404(Subgroup, slug=slug)
        subscription, created = SubgroupSubscription.objects.get_or_create(
            user=request.user,
            subgroup=subgroup,
        )
        if not created:
            return Response(
                {"detail": "Already subscribed to this subgroup."},
                status=status.HTTP_200_OK,
            )
        return Response(
            {"detail": "Successfully subscribed."},
            status=status.HTTP_201_CREATED,
        )


class UnsubscribeView(APIView):
    """Unsubscribe from a subgroup."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, slug: str) -> Response:
        subgroup = get_object_or_404(Subgroup, slug=slug)
        deleted, _ = SubgroupSubscription.objects.filter(
            user=request.user,
            subgroup=subgroup,
        ).delete()
        if not deleted:
            return Response(
                {"detail": "Not subscribed to this subgroup."},
                status=status.HTTP_200_OK,
            )
        return Response(
            {"detail": "Successfully unsubscribed."},
            status=status.HTTP_200_OK,
        )


class SubgroupUpdateView(APIView):
    """Update subgroup description, icon, or membership flag."""

    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request: Request, slug: str) -> Response:
        subgroup = get_object_or_404(Subgroup, slug=slug)
        was_allowing = subgroup.allows_members
        serializer = SubgroupUpdateSerializer(subgroup, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        will_allow = serializer.validated_data.get("allows_members", was_allowing)

        if "links_info" in serializer.validated_data:
            can_edit_links = request.user.is_staff or (
                subgroup.allows_members and _is_member(request.user, subgroup)
            )
            if not can_edit_links:
                return Response(
                    {"detail": "Du har ikke tilladelse til at redigere links og info."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        if (
            "allows_members" in serializer.validated_data
            and will_allow != was_allowing
            and not (request.user.is_staff or _is_member(request.user, subgroup))
        ):
            return Response(
                {"detail": "Du har ikke tilladelse til at ændre medlemskab for denne gruppe."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Disabling membership: block if any private content remains in the group.
        if was_allowing and not will_allow:
            if Thread.objects.filter(subgroup=subgroup, members_only=True).exists():
                return Response(
                    {
                        "detail": (
                            "Kan ikke deaktivere medlemskab: gruppen indeholder private "
                            "tråde. Gør dem offentlige først."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if File.objects.filter(subgroup=subgroup, members_only=True).exists():
                return Response(
                    {
                        "detail": (
                            "Kan ikke deaktivere medlemskab: gruppen indeholder private "
                            "filer. Gør dem offentlige først."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        serializer.save()

        # Enabling membership: auto-enroll the actor as the first member.
        if not was_allowing and will_allow:
            add_member(subgroup, request.user)

        # Disabling membership: clear all memberships (private content already gone).
        if was_allowing and not will_allow:
            SubgroupMembership.objects.filter(subgroup=subgroup).delete()

        return Response({"detail": "Gruppe opdateret."}, status=status.HTTP_200_OK)


class MySubscriptionsView(generics.ListAPIView):
    """List user's subscribed subgroups."""

    serializer_class = SubgroupSubscriptionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self) -> Any:
        return SubgroupSubscription.objects.filter(user=self.request.user).select_related(
            "subgroup"
        )


# Membership Views


def _members_payload(subgroup: Subgroup) -> list[dict]:
    qs = (
        SubgroupMembership.objects.filter(subgroup=subgroup)
        .select_related("user")
        .order_by("user__first_name", "user__last_name")
    )
    return SubgroupMembershipSerializer(qs, many=True).data


class SubgroupMemberListCreateView(APIView):
    """List members of a subgroup or add new ones."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request, slug: str) -> Response:
        subgroup = get_object_or_404(Subgroup, slug=slug)
        return Response(_members_payload(subgroup))

    def post(self, request: Request, slug: str) -> Response:
        subgroup = get_object_or_404(Subgroup, slug=slug)
        if not subgroup.allows_members:
            return Response(
                {"detail": "Denne gruppe tillader ikke medlemmer."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Permission: admin or current member
        is_actor_member = SubgroupMembership.objects.filter(
            user=request.user, subgroup=subgroup
        ).exists()
        if not (request.user.is_staff or is_actor_member):
            return Response(
                {"detail": "Kun medlemmer eller administratorer kan tilføje medlemmer."},
                status=status.HTTP_403_FORBIDDEN,
            )
        user_ids = request.data.get("user_ids") or []
        if not isinstance(user_ids, list) or not user_ids:
            return Response(
                {"detail": "user_ids skal være en ikke-tom liste."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        from apps.users.models import User as UserModel

        users = list(UserModel.objects.filter(id__in=user_ids, is_active=True))
        added_user_ids: list[int] = []
        for user in users:
            existed = SubgroupMembership.objects.filter(user=user, subgroup=subgroup).exists()
            add_member(subgroup, user)
            if not existed:
                added_user_ids.append(user.id)

        # Notify added users (not the actor themselves)
        from apps.notifications.tasks import notify_subgroup_member_added_task

        for uid in added_user_ids:
            if uid == request.user.id:
                continue
            notify_subgroup_member_added_task(
                user_id=uid,
                actor_id=request.user.id,
                subgroup_id=subgroup.id,
                subgroup_name=subgroup.name,
                subgroup_slug=subgroup.slug,
            )
        return Response(_members_payload(subgroup), status=status.HTTP_200_OK)


class SubgroupMemberDetailView(APIView):
    """Update or delete a single membership."""

    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request: Request, slug: str, user_id: int) -> Response:
        subgroup = get_object_or_404(Subgroup, slug=slug)
        # Any current member or admin can edit any role
        is_actor_member = SubgroupMembership.objects.filter(
            user=request.user, subgroup=subgroup
        ).exists()
        if not (request.user.is_staff or is_actor_member):
            return Response(
                {"detail": "Kun medlemmer eller administratorer kan ændre roller."},
                status=status.HTTP_403_FORBIDDEN,
            )
        membership = get_object_or_404(SubgroupMembership, subgroup=subgroup, user_id=user_id)
        role = request.data.get("role", "").strip() or "Medlem"
        membership.role = role[:100]
        membership.save(update_fields=["role"])
        return Response(_members_payload(subgroup))

    def delete(self, request: Request, slug: str, user_id: int) -> Response:
        subgroup = get_object_or_404(Subgroup, slug=slug)
        is_actor_member = SubgroupMembership.objects.filter(
            user=request.user, subgroup=subgroup
        ).exists()
        if not (request.user.is_staff or is_actor_member):
            return Response(
                {"detail": "Kun medlemmer eller administratorer kan fjerne medlemmer."},
                status=status.HTTP_403_FORBIDDEN,
            )
        membership = get_object_or_404(SubgroupMembership, subgroup=subgroup, user_id=user_id)
        removed_user_id = membership.user_id
        membership.delete()
        # Notify the removed user unless they removed themselves
        if removed_user_id != request.user.id:
            from apps.notifications.tasks import notify_subgroup_member_removed_task

            notify_subgroup_member_removed_task(
                user_id=removed_user_id,
                actor_id=request.user.id,
                subgroup_id=subgroup.id,
                subgroup_name=subgroup.name,
                subgroup_slug=subgroup.slug,
            )
        return Response(_members_payload(subgroup))


class SubgroupLeaveView(APIView):
    """Leave a group (self-removal)."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, slug: str) -> Response:
        subgroup = get_object_or_404(Subgroup, slug=slug)
        deleted = remove_member(subgroup, request.user)
        if not deleted:
            return Response(
                {"detail": "Du er ikke medlem af denne gruppe."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({"detail": "Du har forladt gruppen."})


# Thread Views
class ThreadPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


class ThreadListCreateView(generics.ListCreateAPIView):
    """List threads in a subgroup or create a new thread.

    Supports ?is_closed=true|false to filter open vs closed threads —
    the open and closed tabs on the frontend paginate independently.
    """

    permission_classes = [permissions.IsAuthenticated]
    pagination_class = ThreadPagination

    def get_serializer_class(self) -> type:
        if self.request.method == "POST":
            return ThreadCreateSerializer
        return ThreadSerializer

    def get_queryset(self) -> Any:
        self._subgroup = get_object_or_404(Subgroup, slug=self.kwargs["slug"])
        qs = (
            filter_visible_threads(
                Thread.objects.filter(subgroup=self._subgroup), self.request.user
            )
            .select_related("author")
            .annotate(post_count_annotation=Count("posts"))
            # Explicit order_by matches Thread.Meta.ordering and silences DRF's
            # UnorderedObjectListWarning on paginated responses.
            .order_by("-is_pinned", "-updated_at", "-id")
        )
        is_closed_param = self.request.query_params.get("is_closed")
        if is_closed_param is not None:
            truthy = is_closed_param.strip().lower() in ("true", "1", "yes")
            qs = qs.filter(is_closed=truthy)
        return qs

    def list(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        # Resolve the page first so serializer context can scope unread / last-post
        # lookups to the current page instead of the whole (potentially huge) subgroup.
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        if page is not None:
            self._page_threads = list(page)
            serializer = self.get_serializer(self._page_threads, many=True)
            return self.get_paginated_response(serializer.data)
        self._page_threads = list(queryset)
        serializer = self.get_serializer(self._page_threads, many=True)
        return Response(serializer.data)

    def get_serializer_context(self) -> dict:
        context = super().get_serializer_context()
        subgroup = getattr(self, "_subgroup", None) or get_object_or_404(
            Subgroup, slug=self.kwargs["slug"]
        )
        if self.request.method == "POST":
            context["subgroup"] = subgroup
        elif self.request.user.is_authenticated:
            page_threads = getattr(self, "_page_threads", None)
            if page_threads is None:
                return context
            thread_ids = [t.id for t in page_threads]
            read_map = dict(
                ThreadReadStatus.objects.filter(
                    user=self.request.user, thread_id__in=thread_ids
                ).values_list("thread_id", "last_read_at")
            )
            context["unread_thread_ids"] = {
                t.id
                for t in page_threads
                if read_map.get(t.id) is None or t.updated_at > read_map[t.id]
            }
            # Batch-load last post per thread in the current page only.
            latest_post_ids = (
                Post.objects.filter(thread_id__in=thread_ids)
                .values("thread_id")
                .annotate(latest_id=Max("id"))
                .values_list("latest_id", flat=True)
            )
            latest_posts = Post.objects.filter(id__in=latest_post_ids).select_related("author")
            context["last_posts_map"] = {p.thread_id: p for p in latest_posts}
        return context


class ThreadDetailView(generics.RetrieveAPIView):
    """Get thread details with all posts."""

    serializer_class = ThreadDetailSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = Thread.objects.prefetch_related(
        "posts__author",
        "posts__attachments__uploaded_by",
        "posts__reactions__user",
        "posts__poll__options__votes__user",
    ).select_related("author", "subgroup")

    def get_object(self) -> Thread:
        obj = super().get_object()
        if not can_view_thread(self.request.user, obj):
            from django.http import Http404

            raise Http404
        return obj

    def retrieve(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        response = super().retrieve(request, *args, **kwargs)
        thread = self.get_object()
        now = timezone.now()
        ThreadReadStatus.objects.bulk_create(
            [ThreadReadStatus(user=request.user, thread=thread, last_read_at=now)],
            update_conflicts=True,
            unique_fields=["user", "thread"],
            update_fields=["last_read_at"],
        )
        return response


class ThreadDetailBySlugView(generics.RetrieveAPIView):
    """Get thread details by subgroup slug + thread slug."""

    serializer_class = ThreadDetailSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self) -> Thread:
        qs = Thread.objects.prefetch_related(
            "posts__author",
            "posts__attachments__uploaded_by",
            "posts__reactions__user",
            "posts__poll__options__votes__user",
        ).select_related("author", "subgroup")

        thread_slug = self.kwargs["thread_slug"]
        subgroup_slug = self.kwargs["subgroup_slug"]

        # Try exact match first; fall back to global slug lookup (handles moved threads)
        thread = qs.filter(subgroup__slug=subgroup_slug, slug=thread_slug).first()
        if thread is None:
            thread = get_object_or_404(qs, slug=thread_slug)

        if not can_view_thread(self.request.user, thread):
            from django.http import Http404

            raise Http404

        now = timezone.now()
        ThreadReadStatus.objects.bulk_create(
            [ThreadReadStatus(user=self.request.user, thread=thread, last_read_at=now)],
            update_conflicts=True,
            unique_fields=["user", "thread"],
            update_fields=["last_read_at"],
        )
        return thread


class ThreadUpdateView(generics.UpdateAPIView):
    """Update a thread title (owner or admin)."""

    serializer_class = ThreadUpdateSerializer
    permission_classes = [permissions.IsAuthenticated, IsOwnerOrAdmin]
    queryset = Thread.objects.all()
    http_method_names = ["patch"]

    def get_object(self) -> Thread:
        obj = super().get_object()
        if not can_view_thread(self.request.user, obj):
            from django.http import Http404

            raise Http404
        return obj

    def perform_update(self, serializer: Any) -> None:
        # Permission check for flipping members_only: must be author or current member.
        new_members_only = serializer.validated_data.get("members_only")
        instance = serializer.instance
        if new_members_only is not None and new_members_only != instance.members_only:
            user = self.request.user
            is_author = instance.author_id == user.id
            is_member = SubgroupMembership.objects.filter(
                user=user, subgroup_id=instance.subgroup_id
            ).exists()
            if not (is_author or is_member or user.is_staff):
                from rest_framework.exceptions import PermissionDenied

                raise PermissionDenied("Du kan ikke ændre denne tråds synlighed.")
            if new_members_only and not instance.subgroup.allows_members:
                from rest_framework.exceptions import ValidationError

                raise ValidationError("Denne gruppe tillader ikke private tråde.")
        serializer.save()


class ThreadDeleteView(generics.DestroyAPIView):
    """Delete a thread (owner or admin)."""

    permission_classes = [permissions.IsAuthenticated, IsOwnerOrAdmin]
    queryset = Thread.objects.all()

    def get_object(self) -> Thread:
        # Visibility check BEFORE permission check so invisible threads
        # return 404, not 403 (prevents leaking existence).
        obj = get_object_or_404(Thread, pk=self.kwargs[self.lookup_field or "pk"])
        if not can_view_thread(self.request.user, obj):
            from django.http import Http404

            raise Http404
        self.check_object_permissions(self.request, obj)
        return obj


class ThreadMoveView(APIView):
    """Move a thread to a different subgroup (owner or admin only)."""

    permission_classes = [permissions.IsAuthenticated, IsOwnerOrAdmin]

    def get_object(self, pk: int) -> Thread:
        obj = get_object_or_404(Thread, pk=pk)
        if not can_view_thread(self.request.user, obj):
            from django.http import Http404

            raise Http404
        self.check_object_permissions(self.request, obj)
        return obj

    def post(self, request: Request, pk: int) -> Response:
        thread = self.get_object(pk)
        subgroup_slug = request.data.get("subgroup_slug")
        if not subgroup_slug:
            return Response(
                {"detail": "subgroup_slug is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        new_subgroup = get_object_or_404(Subgroup, slug=subgroup_slug)
        if new_subgroup.id == thread.subgroup_id:
            return Response(
                {"detail": "Tråden er allerede i denne gruppe."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if Thread.objects.filter(subgroup=new_subgroup, slug=thread.slug).exists():
            return Response(
                {"detail": "Der findes allerede en tråd med samme URL-navn i den valgte gruppe."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        thread.subgroup = new_subgroup
        thread.save(update_fields=["subgroup"])
        return Response(
            {
                "detail": "Tråden blev flyttet.",
                "subgroup_slug": new_subgroup.slug,
                "thread_slug": thread.slug,
            },
            status=status.HTTP_200_OK,
        )


class ThreadPinView(APIView):
    """Pin or unpin a thread (any authenticated user)."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        """Toggle the pinned state of a thread."""
        thread = get_object_or_404(Thread, pk=pk)
        if not can_view_thread(request.user, thread):
            from django.http import Http404

            raise Http404
        if "is_pinned" in request.data:
            value = request.data["is_pinned"]
            if isinstance(value, str):
                thread.is_pinned = value.lower() in ("true", "1", "yes")
            else:
                thread.is_pinned = bool(value)
        else:
            thread.is_pinned = not thread.is_pinned
        thread.save(update_fields=["is_pinned"])

        action = "fastgjort" if thread.is_pinned else "løsnet"
        return Response(
            {
                "detail": f"Tråden blev {action}.",
                "is_pinned": thread.is_pinned,
            },
            status=status.HTTP_200_OK,
        )


class ThreadCloseView(APIView):
    """Close or reopen a thread (owner or admin only)."""

    permission_classes = [permissions.IsAuthenticated, IsOwnerOrAdmin]

    def get_object(self, pk: int) -> Thread:
        obj = get_object_or_404(Thread, pk=pk)
        if not can_view_thread(self.request.user, obj):
            from django.http import Http404

            raise Http404
        self.check_object_permissions(self.request, obj)
        return obj

    def post(self, request: Request, pk: int) -> Response:
        """Toggle the closed state of a thread."""
        thread = self.get_object(pk)
        # Toggle the closed state, or use explicit value if provided
        if "is_closed" in request.data:
            value = request.data["is_closed"]
            # Handle string values from form data
            if isinstance(value, str):
                thread.is_closed = value.lower() in ("true", "1", "yes")
            else:
                thread.is_closed = bool(value)
        else:
            thread.is_closed = not thread.is_closed
        thread.save(update_fields=["is_closed"])

        action = "lukket" if thread.is_closed else "genåbnet"
        return Response(
            {
                "detail": f"Tråden blev {action}.",
                "is_closed": thread.is_closed,
            },
            status=status.HTTP_200_OK,
        )


# Post Views
class PostListCreateView(generics.ListCreateAPIView):
    """List posts in a thread or create a new post."""

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self) -> type:
        if self.request.method == "POST":
            return PostCreateSerializer
        return PostSerializer

    def get_queryset(self) -> Any:
        thread = get_object_or_404(Thread, pk=self.kwargs["thread_id"])
        if not can_view_thread(self.request.user, thread):
            from django.http import Http404

            raise Http404
        return (
            Post.objects.filter(thread=thread)
            .select_related("author")
            .prefetch_related(
                "attachments__uploaded_by", "reactions__user", "poll__options__votes__user"
            )
        )

    def get_serializer_context(self) -> dict:
        context = super().get_serializer_context()
        if self.request.method == "POST":
            context["thread"] = get_object_or_404(Thread, pk=self.kwargs["thread_id"])
        return context

    def create(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        """Override create to enforce visibility (closed threads auto-reopen on reply)."""
        thread = get_object_or_404(Thread, pk=self.kwargs["thread_id"])
        if not can_view_thread(request.user, thread):
            from django.http import Http404

            raise Http404
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer: Any) -> None:
        serializer.save()
        thread = get_object_or_404(Thread, pk=self.kwargs["thread_id"])
        # A reply on a closed thread auto-reopens it.
        update_fields = ["updated_at"]
        if thread.is_closed:
            thread.is_closed = False
            update_fields.append("is_closed")
        thread.save(update_fields=update_fields)
        # Send mention notifications (these take precedence — reply notifications
        # were already skipped for mentioned users in the serializer)
        from apps.notifications.tasks import notify_mentions_task

        post = serializer.instance
        mention_ids = getattr(post, "_mention_ids", [])
        if mention_ids and post.author:
            link = f"/forum/{thread.subgroup.slug}/traad/{thread.slug}#post-{post.id}"
            notify_mentions_task(
                author_id=post.author.id,
                mentioned_user_ids=mention_ids,
                context_label=f"indlæg i '{thread.title}'",
                link=link,
            )


class PostUpdateDeleteView(generics.RetrieveUpdateDestroyAPIView):
    """Update or delete a post (owner or admin)."""

    serializer_class = PostSerializer
    permission_classes = [permissions.IsAuthenticated, IsOwnerOrAdmin]
    queryset = Post.objects.prefetch_related("attachments__uploaded_by").all()

    def get_serializer_class(self) -> type:
        if self.request.method in ["PUT", "PATCH"]:
            return PostCreateSerializer
        return PostSerializer

    def perform_update(self, serializer: Any) -> None:
        from apps.notifications.tasks import notify_mentions_task, notify_post_edited_by_admin_task
        from apps.notifications.utils import extract_mention_ids

        old_content = serializer.instance.content or ""
        old_mention_ids = set(extract_mention_ids(old_content))

        post = serializer.instance
        is_admin_edit = post.author_id != self.request.user.id
        if is_admin_edit:
            serializer.save(edited_by=self.request.user)
        else:
            serializer.save()

        new_content = post.content or ""
        new_mention_ids = set(extract_mention_ids(new_content))
        new_mentions = list(new_mention_ids - old_mention_ids)

        if new_mentions and post.author:
            thread = post.thread
            link = f"/forum/{thread.subgroup.slug}/traad/{thread.slug}#post-{post.id}"
            notify_mentions_task(
                author_id=post.author.id,
                mentioned_user_ids=new_mentions,
                context_label=f"indlæg i '{thread.title}'",
                link=link,
            )

        if is_admin_edit and post.author_id and self.request.user.is_staff:
            thread = post.thread
            notify_post_edited_by_admin_task(
                post_author_id=post.author_id,
                editor_id=self.request.user.id,
                thread_title=thread.title,
                thread_id=thread.id,
                subgroup_slug=thread.subgroup.slug,
                thread_slug=thread.slug,
                post_id=post.id,
            )

    def perform_destroy(self, instance: Any) -> None:
        thread = instance.thread
        # If this is the first post (thread starter), delete the entire thread
        first_post = thread.posts.order_by("created_at").first()
        if first_post and first_post.pk == instance.pk:
            thread.delete()
        else:
            instance.delete()


# Folder Views
class FolderListCreateView(generics.ListCreateAPIView):
    """List folders in a subgroup or create a new folder."""

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self) -> type:
        if self.request.method == "POST":
            return FolderCreateSerializer
        return FolderSerializer

    def get_queryset(self) -> Any:
        subgroup = get_object_or_404(Subgroup, slug=self.kwargs["slug"])
        parent_id = self.request.query_params.get("parent")
        visible_ids = visible_folder_ids(self.request.user, subgroup)
        queryset = Folder.objects.filter(subgroup=subgroup, id__in=visible_ids)
        if parent_id:
            queryset = queryset.filter(parent_id=parent_id)
        else:
            queryset = queryset.filter(parent__isnull=True)
        return queryset

    def get_serializer_context(self) -> dict:
        from .services import visible_files_q

        context = super().get_serializer_context()
        if self.request.method == "POST":
            context["subgroup"] = get_object_or_404(Subgroup, slug=self.kwargs["slug"])
        elif self.request.method == "GET":
            subgroup = get_object_or_404(Subgroup, slug=self.kwargs["slug"])
            context["visible_folder_ids"] = visible_folder_ids(self.request.user, subgroup)
            context["visible_files_filter"] = visible_files_q(self.request.user)
        return context

    def perform_create(self, serializer: Any) -> None:
        # In a members-only subgroup, only formal members may create folders —
        # otherwise the creator (a non-member) would be unable to see their
        # own folder, and the directory structure is members' territory.
        # Open subgroups have no privacy boundary, so anyone authenticated can
        # create folders (consistent with anyone being able to upload files).
        subgroup = get_object_or_404(Subgroup, slug=self.kwargs["slug"])
        if subgroup.allows_members:
            user = self.request.user
            is_member = SubgroupMembership.objects.filter(user=user, subgroup=subgroup).exists()
            if not is_member:
                from rest_framework.exceptions import PermissionDenied

                raise PermissionDenied("Kun medlemmer af gruppen kan oprette mapper.")
        serializer.save()


class FolderDetailView(generics.RetrieveDestroyAPIView):
    """Get folder details, or delete a folder and all its contents."""

    serializer_class = FolderSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self) -> Any:
        return Folder.objects.all()

    def get_object(self) -> Folder:
        folder = get_object_or_404(Folder, pk=self.kwargs["pk"])
        if folder.subgroup_id is not None:
            visible_ids = visible_folder_ids(self.request.user, folder.subgroup)
            if folder.id not in visible_ids:
                raise Http404
        return folder

    def perform_destroy(self, instance: Folder) -> None:
        # Same gate as folder creation: in members-only subgroups, only members
        # may delete; in open subgroups any authenticated user may.
        subgroup = instance.subgroup
        if subgroup is not None and subgroup.allows_members:
            user = self.request.user
            is_member = SubgroupMembership.objects.filter(user=user, subgroup=subgroup).exists()
            if not is_member:
                from rest_framework.exceptions import PermissionDenied

                raise PermissionDenied("Kun medlemmer af gruppen kan slette mapper.")

        # Django's CASCADE does bulk SQL DELETE on descendant files, which
        # bypasses File.delete() and leaks blobs on disk. Walk the subtree and
        # delete files individually so storage cleanup runs, then drop the
        # folder (cascade handles the remaining empty subfolders).
        for f in File.objects.filter(folder_id__in=folder_subtree_ids(instance)):
            f.delete()

        instance.delete()


class FolderDeletePreviewView(APIView):
    """Return how many subfolders and files would be deleted with this folder.

    Used by the delete-confirmation UI to inform the user about the cascade
    impact before they confirm. Gated by the same rule as folder deletion so
    we don't expose counts to users who couldn't delete the folder anyway.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request, pk: int) -> Response:
        folder = get_object_or_404(Folder, pk=pk)
        subgroup = folder.subgroup
        if subgroup is not None and subgroup.allows_members:
            is_member = SubgroupMembership.objects.filter(
                user=request.user, subgroup=subgroup
            ).exists()
            if not is_member:
                from rest_framework.exceptions import PermissionDenied

                raise PermissionDenied("Kun medlemmer af gruppen kan slette mapper.")

        ids = folder_subtree_ids(folder)
        return Response(
            {
                "file_count": File.objects.filter(folder_id__in=ids).count(),
                "subfolder_count": len(ids) - 1,
            }
        )


class FolderBySlugView(generics.RetrieveAPIView):
    """Get folder by subgroup slug + folder slug."""

    serializer_class = FolderSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self) -> Folder:
        subgroup = get_object_or_404(Subgroup, slug=self.kwargs["slug"])
        folder = get_object_or_404(Folder, subgroup=subgroup, slug=self.kwargs["folder_slug"])
        visible_ids = visible_folder_ids(self.request.user, subgroup)
        if folder.id not in visible_ids:
            raise Http404
        return folder


# File Views
class SubgroupFileListCreateView(generics.ListCreateAPIView):
    """List root-level files in a subgroup or upload a new file."""

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self) -> type:
        if self.request.method == "POST":
            return FileUploadSerializer
        return FileSerializer

    def get_queryset(self) -> Any:
        subgroup = get_object_or_404(Subgroup, slug=self.kwargs["slug"])
        return filter_visible_files(
            File.objects.filter(subgroup=subgroup, folder__isnull=True),
            self.request.user,
        ).select_related("uploaded_by")

    def get_serializer_context(self) -> dict:
        context = super().get_serializer_context()
        if self.request.method == "POST":
            context["subgroup"] = get_object_or_404(Subgroup, slug=self.kwargs["slug"])
            context["folder"] = None
        return context


class FileListCreateView(generics.ListCreateAPIView):
    """List files in a folder or upload a new file."""

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self) -> type:
        if self.request.method == "POST":
            return FileUploadSerializer
        return FileSerializer

    def get_queryset(self) -> Any:
        folder = get_object_or_404(Folder, pk=self.kwargs["folder_id"])
        return filter_visible_files(
            File.objects.filter(folder=folder), self.request.user
        ).select_related("uploaded_by")

    def get_serializer_context(self) -> dict:
        context = super().get_serializer_context()
        if self.request.method == "POST":
            folder = get_object_or_404(Folder, pk=self.kwargs["folder_id"])
            context["folder"] = folder
            context["subgroup"] = folder.subgroup
        return context


class FileDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Retrieve, partially update (members_only), or delete a file."""

    queryset = File.objects.all()
    http_method_names = ["get", "patch", "delete"]

    def get_serializer_class(self) -> type:
        if self.request.method == "PATCH":
            return FilePartialUpdateSerializer
        return FileSerializer

    def get_permissions(self) -> list:
        if self.request.method == "DELETE":
            return [permissions.IsAuthenticated(), IsOwnerOrReadOnly()]
        return [permissions.IsAuthenticated()]

    def get_object(self) -> File:
        obj = super().get_object()
        if self.request.method == "GET" and not can_view_file(self.request.user, obj):
            from django.http import Http404

            raise Http404
        return obj

    def perform_update(self, serializer: Any) -> None:
        instance = serializer.instance
        # Only the uploader or members of the subgroup can flip privacy.
        user = self.request.user
        is_uploader = instance.uploaded_by_id == user.id
        is_member = (
            instance.subgroup_id is not None
            and SubgroupMembership.objects.filter(
                user=user, subgroup_id=instance.subgroup_id
            ).exists()
        )
        if not (is_uploader or is_member or user.is_staff):
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied("Du har ikke tilladelse til at ændre denne fil.")
        # Disallow setting members_only=True on a group that doesn't allow members.
        new_members_only = serializer.validated_data.get("members_only")
        if (
            new_members_only is True
            and instance.subgroup_id is not None
            and not instance.subgroup.allows_members
        ):
            from rest_framework.exceptions import ValidationError

            raise ValidationError("Denne gruppe tillader ikke private filer.")
        serializer.save()

    def perform_destroy(self, instance: File) -> None:
        if instance.file:
            instance.file.delete(save=False)
        instance.delete()


class FileMoveView(APIView):
    """Move a file to a different folder (owner or admin only)."""

    permission_classes = [permissions.IsAuthenticated, IsOwnerOrAdmin]

    def get_object(self, pk: int) -> File:
        obj = get_object_or_404(File, pk=pk)
        if not can_view_file(self.request.user, obj):
            from django.http import Http404

            raise Http404
        self.check_object_permissions(self.request, obj)
        return obj

    def patch(self, request: Request, pk: int) -> Response:
        file = self.get_object(pk)
        folder_id = request.data.get("folder_id")

        if folder_id is None:
            # Move to root level of the subgroup
            file.folder = None
        else:
            # Move to specified folder
            folder = get_object_or_404(Folder, pk=folder_id)
            # Ensure the folder belongs to the same subgroup
            if folder.subgroup_id != file.subgroup_id:
                return Response(
                    {"detail": "Cannot move file to a folder in a different subgroup."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            file.folder = folder

        file.save(update_fields=["folder"])
        return Response({"detail": "File moved successfully."}, status=status.HTTP_200_OK)


class FolderDownloadView(APIView):
    """Download all files in a folder (including subfolders) as a zip."""

    permission_classes = [permissions.IsAuthenticated]
    MAX_ZIP_SIZE = 100 * 1024 * 1024  # 100 MB

    def get(self, request: Request, pk: int) -> FileResponse | Response:
        folder = get_object_or_404(Folder, pk=pk)
        if folder.subgroup_id is not None:
            visible_ids = visible_folder_ids(request.user, folder.subgroup)
            if folder.id not in visible_ids:
                raise Http404

        buf = io.BytesIO()
        total_size = 0
        try:
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
                total_size = self._add_folder(zf, folder, "", total_size)
        except _ZipSizeLimitError:
            return Response(
                {"detail": "Mappen er for stor til at downloade som zip (maks 100 MB)."},
                status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            )

        buf.seek(0)
        return FileResponse(
            buf,
            as_attachment=True,
            filename=f"{folder.name}.zip",
            content_type="application/zip",
        )

    def _add_folder(self, zf: zipfile.ZipFile, folder: Folder, prefix: str, total_size: int) -> int:
        path = f"{prefix}{folder.name}/"
        files_qs = filter_visible_files(File.objects.filter(folder=folder), self.request.user)
        for file_obj in files_qs:
            if file_obj.file and file_obj.file.storage.exists(file_obj.file.name):
                with file_obj.file.open("rb") as f:
                    data = f.read()
                total_size += len(data)
                if total_size > self.MAX_ZIP_SIZE:
                    raise _ZipSizeLimitError
                zf.writestr(f"{path}{file_obj.name}", data)
        for subfolder in Folder.objects.filter(parent=folder):
            total_size = self._add_folder(zf, subfolder, path, total_size)
        return total_size


class _ZipSizeLimitError(Exception):
    """Raised when cumulative zip content exceeds the size limit."""


class RecentActivityView(generics.ListAPIView):
    """
    List recent forum posts across all subgroups.
    Returns the most recent posts with thread and subgroup context.
    """

    serializer_class = RecentActivitySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self) -> Any:
        try:
            limit = int(self.request.query_params.get("limit", 10))
        except (ValueError, TypeError):
            limit = 10
        limit = min(max(limit, 1), 50)  # Clamp between 1 and 50

        # Apply the thread-visibility predicate against the joined `forum_thread` rows
        # (already pulled in by select_related). The previous `thread_id__in=Thread...`
        # form forced SQLite to materialize the subquery before joining; filtering on
        # the join columns directly avoids that.
        user = self.request.user
        if not user or not user.is_authenticated:
            visibility = Q(thread__members_only=False)
        else:
            member_ids = member_subgroup_ids(user)
            visibility = (
                Q(thread__members_only=False)
                | Q(thread__subgroup_id__in=member_ids)
                | Q(thread__author_id=user.id)
            )
        return (
            Post.objects.select_related("author", "thread", "thread__subgroup")
            .filter(visibility)
            .order_by("-created_at")[:limit]
        )


class ReactionToggleView(APIView):
    """Toggle a reaction on a post."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, post_id: int) -> Response:
        """Add or remove a reaction from a post."""
        from apps.notifications.services import notify_post_reaction

        post = get_object_or_404(Post, pk=post_id)
        reaction_type = request.data.get("reaction_type", "").strip()

        if not reaction_type or len(reaction_type) > 50:
            return Response(
                {"detail": "Invalid reaction type."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Toggle the reaction
        existing = Reaction.objects.filter(
            post=post, user=request.user, reaction_type=reaction_type
        ).first()

        if existing:
            existing.delete()
            return Response(
                {"detail": "Reaction removed.", "action": "removed"},
                status=status.HTTP_200_OK,
            )
        else:
            Reaction.objects.create(post=post, user=request.user, reaction_type=reaction_type)
            # Notify the post author
            if post.author:
                notify_post_reaction(
                    post_author=post.author,
                    reactor=request.user,
                    thread_title=post.thread.title,
                    thread_id=post.thread.id,
                    subgroup_slug=post.thread.subgroup.slug,
                    thread_slug=post.thread.slug,
                    reaction_emoji=reaction_type,
                    post_id=post.id,
                )
            return Response(
                {"detail": "Reaction added.", "action": "added"},
                status=status.HTTP_201_CREATED,
            )


class ReactionTypesView(APIView):
    """Get available reaction types."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> Response:
        """Return default quick-reaction emojis."""
        defaults = [
            "\U0001f44d",
            "\u2764\ufe0f",
            "\U0001f602",
            "\U0001f62e",
            "\U0001f622",
            "\U0001f389",
        ]
        return Response([{"type": e, "emoji": e} for e in defaults])


class SubgroupRoleListView(APIView):
    """Return the curated list of subgroup role labels (admin-editable)."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> Response:
        names = list(SubgroupRoleOption.objects.values_list("name", flat=True))
        return Response(names)


# Poll Views
class PollVoteView(APIView):
    """Vote on a poll option (toggle)."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, poll_id: int) -> Response:
        poll = get_object_or_404(Poll, pk=poll_id)
        option_id = request.data.get("option_id")

        if not option_id:
            return Response(
                {"detail": "option_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        option = get_object_or_404(PollOption, pk=option_id, poll=poll)

        # Check if user already voted for this option
        existing_vote = PollVote.objects.filter(option=option, user=request.user).first()

        if existing_vote:
            # Toggle off - remove the vote
            existing_vote.delete()
            return Response(
                {"detail": "Vote removed.", "action": "removed"},
                status=status.HTTP_200_OK,
            )

        # For single-choice polls, remove any existing votes on other options
        if not poll.allow_multiple_votes:
            PollVote.objects.filter(option__poll=poll, user=request.user).delete()

        PollVote.objects.create(option=option, user=request.user)
        return Response(
            {"detail": "Vote recorded.", "action": "added"},
            status=status.HTTP_201_CREATED,
        )


class PollDeleteView(APIView):
    """Update or delete a poll (creator or admin only)."""

    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request: Request, poll_id: int) -> Response:
        poll = get_object_or_404(Poll, pk=poll_id)

        if poll.created_by != request.user and not request.user.is_staff:
            return Response(
                {"detail": "You do not have permission to edit this poll."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = PollUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # Update poll fields
        update_fields = []
        if "question" in data:
            poll.question = data["question"]
            update_fields.append("question")
        if "allow_multiple_votes" in data:
            poll.allow_multiple_votes = data["allow_multiple_votes"]
            update_fields.append("allow_multiple_votes")
        if "is_anonymous" in data:
            poll.is_anonymous = data["is_anonymous"]
            update_fields.append("is_anonymous")
        if "allow_others_to_add_options" in data:
            poll.allow_others_to_add_options = data["allow_others_to_add_options"]
            update_fields.append("allow_others_to_add_options")
        if update_fields:
            poll.save(update_fields=update_fields)

        # Update options if provided
        if "options" in data:
            existing_options = {o.id: o for o in poll.options.all()}
            submitted_ids = {o["id"] for o in data["options"] if o.get("id")}

            # Check that options being removed have no votes
            ids_to_delete = set(existing_options.keys()) - submitted_ids
            for option_id in ids_to_delete:
                option = existing_options[option_id]
                if option.votes.count() > 0:
                    return Response(
                        {
                            "detail": f"Kan ikke fjerne valgmulighed '{option.text}' da den har stemmer."
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            PollOption.objects.filter(id__in=ids_to_delete).delete()

            # Update existing options and create new ones in order
            for i, option_data in enumerate(data["options"]):
                option_id = option_data.get("id")
                if option_id and option_id in existing_options:
                    PollOption.objects.filter(id=option_id).update(
                        text=option_data["text"], order=i
                    )
                else:
                    PollOption.objects.create(poll=poll, text=option_data["text"], order=i)

        return Response(PollSerializer(poll, context={"request": request}).data)

    def delete(self, request: Request, poll_id: int) -> Response:
        poll = get_object_or_404(Poll, pk=poll_id)

        if poll.created_by != request.user and not request.user.is_staff:
            return Response(
                {"detail": "You do not have permission to delete this poll."},
                status=status.HTTP_403_FORBIDDEN,
            )

        poll.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PollAddOptionView(APIView):
    """Add an option to a poll (creator, staff, or anyone if poll allows it)."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, poll_id: int) -> Response:
        poll = get_object_or_404(Poll, pk=poll_id)

        is_creator = poll.created_by_id == request.user.id
        if not (is_creator or request.user.is_staff or poll.allow_others_to_add_options):
            return Response(
                {"detail": "Du har ikke tilladelse til at tilføje valgmuligheder."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if poll.options.count() >= 20:
            return Response(
                {"detail": "En afstemning kan højst have 20 valgmuligheder."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        text = (request.data.get("text") or "").strip()
        if not text:
            return Response(
                {"detail": "Valgmulighed må ikke være tom."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(text) > 200:
            return Response(
                {"detail": "Valgmulighed må højst være 200 tegn."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        next_order = (poll.options.aggregate(m=Max("order"))["m"] or -1) + 1
        PollOption.objects.create(poll=poll, text=text, order=next_order)

        return Response(PollSerializer(poll, context={"request": request}).data)


# Read Status Views
class MarkAllForumReadView(APIView):
    """Mark all forum threads as read for the current user."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request) -> Response:
        from apps.notifications.models import Notification, NotificationType

        now = timezone.now()
        threads = Thread.objects.filter(visible_threads_q(request.user))
        records = [
            ThreadReadStatus(user=request.user, thread=thread, last_read_at=now)
            for thread in threads
        ]
        ThreadReadStatus.objects.bulk_create(
            records,
            update_conflicts=True,
            unique_fields=["user", "thread"],
            update_fields=["last_read_at"],
        )
        Notification.objects.filter(
            user=request.user,
            is_read=False,
            notification_type__in=[
                NotificationType.NEW_THREAD,
                NotificationType.THREAD_REPLY,
                NotificationType.POST_REPLY,
                NotificationType.POST_REACTION,
                NotificationType.MENTION,
                NotificationType.SUBGROUP_ACTIVITY,
            ],
            link__startswith="/forum/",
        ).update(is_read=True)
        return Response({"detail": "Alt markeret som læst."}, status=status.HTTP_200_OK)


class MarkSubgroupReadView(APIView):
    """Mark all threads in a subgroup as read for the current user."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, slug: str) -> Response:
        from apps.notifications.models import Notification

        subgroup = get_object_or_404(Subgroup, slug=slug)
        now = timezone.now()
        threads = Thread.objects.filter(subgroup=subgroup).filter(visible_threads_q(request.user))
        records = [
            ThreadReadStatus(user=request.user, thread=thread, last_read_at=now)
            for thread in threads
        ]
        ThreadReadStatus.objects.bulk_create(
            records,
            update_conflicts=True,
            unique_fields=["user", "thread"],
            update_fields=["last_read_at"],
        )
        Notification.objects.filter(
            user=request.user,
            is_read=False,
            link__startswith=f"/forum/{subgroup.slug}/traad/",
        ).update(is_read=True)
        return Response({"detail": "Gruppen markeret som læst."}, status=status.HTTP_200_OK)


class ForumUnreadCountView(APIView):
    """Get total unread thread count across all subgroups."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> Response:
        user = request.user
        subscribed_since_sq = SubgroupSubscription.objects.filter(
            user=user, subgroup_id=OuterRef("subgroup_id")
        ).values("created_at")[:1]
        last_read_sq = ThreadReadStatus.objects.filter(user=user, thread_id=OuterRef("pk")).values(
            "last_read_at"
        )[:1]

        count = (
            Thread.objects.filter(
                is_closed=False,
                subgroup_id__in=SubgroupSubscription.objects.filter(user=user).values(
                    "subgroup_id"
                ),
            )
            .filter(visible_threads_q(user))
            .annotate(
                _subscribed_since=Subquery(subscribed_since_sq),
                _last_read=Subquery(last_read_sq),
            )
            .filter(updated_at__gt=F("_subscribed_since"))
            .filter(Q(_last_read__isnull=True) | Q(updated_at__gt=F("_last_read")))
            .count()
        )
        return Response({"unread_count": count})


class ThreadMuteToggleView(APIView):
    """Mute or unmute notifications for a specific thread."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        thread = get_object_or_404(Thread, pk=pk)
        if not can_view_thread(request.user, thread):
            from django.http import Http404

            raise Http404
        mute, created = ThreadMuteStatus.objects.get_or_create(user=request.user, thread=thread)
        if not created:
            mute.delete()
            return Response({"is_muted": False})
        return Response({"is_muted": True})
