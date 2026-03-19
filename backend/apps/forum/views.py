"""
Views for Forum models.
"""

import io
import zipfile
from typing import Any

from django.db.models import Count, Max, Prefetch
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, permissions, status
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
    SubgroupSubscription,
    Thread,
    ThreadMuteStatus,
    ThreadReadStatus,
)
from .serializers import (
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
    SubgroupSerializer,
    SubgroupSubscriptionSerializer,
    SubgroupUpdateSerializer,
    ThreadCreateSerializer,
    ThreadDetailSerializer,
    ThreadSerializer,
    ThreadUpdateSerializer,
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


# Subgroup Views
class SubgroupListView(generics.ListCreateAPIView):
    """List all subgroups or create a new one."""

    permission_classes = [permissions.IsAuthenticated]
    queryset = Subgroup.objects.prefetch_related(
        "threads",
        Prefetch("memberships", queryset=SubgroupMembership.objects.select_related("user")),
    ).all()

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
                SubgroupSubscription.objects.filter(user=user).values_list(
                    "subgroup_id", flat=True
                )
            )
            context["member_subgroup_ids"] = set(
                SubgroupMembership.objects.filter(user=user).values_list(
                    "subgroup_id", flat=True
                )
            )
        return context

    def create(self, request: Request, *args: object, **kwargs: object) -> Response:
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        subgroup = serializer.save()
        out = SubgroupSerializer(subgroup, context=self.get_serializer_context())
        return Response(out.data, status=status.HTTP_201_CREATED)


class SubgroupDetailView(generics.RetrieveAPIView):
    """Get subgroup details."""

    serializer_class = SubgroupSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = Subgroup.objects.prefetch_related(
        "threads",
        Prefetch("memberships", queryset=SubgroupMembership.objects.select_related("user")),
    )
    lookup_field = "slug"

    def get_serializer_context(self) -> dict:
        context = super().get_serializer_context()
        user = self.request.user
        if user.is_authenticated:
            context["subscribed_subgroup_ids"] = set(
                SubgroupSubscription.objects.filter(user=user).values_list(
                    "subgroup_id", flat=True
                )
            )
            context["member_subgroup_ids"] = set(
                SubgroupMembership.objects.filter(user=user).values_list(
                    "subgroup_id", flat=True
                )
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


class SubgroupJoinView(APIView):
    """Join a subgroup (self or add another user)."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, slug: str) -> Response:
        subgroup = get_object_or_404(Subgroup, slug=slug)
        user_id = request.data.get("user_id")

        if user_id:
            # Adding another user — requires membership
            if not SubgroupMembership.objects.filter(user=request.user, subgroup=subgroup).exists():
                return Response(
                    {"detail": "Du skal være medlem for at tilføje andre."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            from apps.users.models import User

            target_user = get_object_or_404(User, pk=user_id)
        else:
            target_user = request.user

        _, created = SubgroupMembership.objects.get_or_create(user=target_user, subgroup=subgroup)
        # Auto-subscribe to notifications
        SubgroupSubscription.objects.get_or_create(user=target_user, subgroup=subgroup)

        if not created:
            return Response({"detail": "Allerede medlem."}, status=status.HTTP_200_OK)
        return Response({"detail": "Medlem tilføjet."}, status=status.HTTP_201_CREATED)


class SubgroupLeaveView(APIView):
    """Leave a subgroup (self or remove another user)."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, slug: str) -> Response:
        subgroup = get_object_or_404(Subgroup, slug=slug)
        user_id = request.data.get("user_id")

        if user_id:
            # Removing another user — requires membership
            if not SubgroupMembership.objects.filter(user=request.user, subgroup=subgroup).exists():
                return Response(
                    {"detail": "Du skal være medlem for at fjerne andre."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            from apps.users.models import User

            target_user = get_object_or_404(User, pk=user_id)
        else:
            target_user = request.user

        deleted, _ = SubgroupMembership.objects.filter(user=target_user, subgroup=subgroup).delete()
        if not deleted:
            return Response({"detail": "Ikke medlem."}, status=status.HTTP_200_OK)
        return Response({"detail": "Medlem fjernet."}, status=status.HTTP_200_OK)


class SubgroupUpdateView(APIView):
    """Update subgroup description (members only)."""

    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request: Request, slug: str) -> Response:
        subgroup = get_object_or_404(Subgroup, slug=slug)
        if not SubgroupMembership.objects.filter(user=request.user, subgroup=subgroup).exists():
            return Response(
                {"detail": "Kun medlemmer kan redigere beskrivelsen."},
                status=status.HTTP_403_FORBIDDEN,
            )
        serializer = SubgroupUpdateSerializer(subgroup, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Beskrivelse opdateret."}, status=status.HTTP_200_OK)


class SubgroupGroupChatView(APIView):
    """Get or create a group conversation for all members."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, slug: str) -> Response:
        from apps.messaging.models import Conversation

        subgroup = get_object_or_404(Subgroup, slug=slug)
        if not SubgroupMembership.objects.filter(user=request.user, subgroup=subgroup).exists():
            return Response(
                {"detail": "Kun medlemmer kan bruge gruppebesked."},
                status=status.HTTP_403_FORBIDDEN,
            )

        member_ids = list(
            SubgroupMembership.objects.filter(subgroup=subgroup).values_list("user_id", flat=True)
        )

        if subgroup.group_conversation:
            # Sync participants
            subgroup.group_conversation.participants.set(member_ids)
            return Response(
                {"conversation_id": subgroup.group_conversation.id}, status=status.HTTP_200_OK
            )

        # Create new conversation
        conversation = Conversation.objects.create()
        conversation.participants.set(member_ids)
        subgroup.group_conversation = conversation
        subgroup.save(update_fields=["group_conversation"])
        return Response({"conversation_id": conversation.id}, status=status.HTTP_201_CREATED)


class MySubscriptionsView(generics.ListAPIView):
    """List user's subscribed subgroups."""

    serializer_class = SubgroupSubscriptionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self) -> Any:
        return SubgroupSubscription.objects.filter(user=self.request.user).select_related(
            "subgroup"
        )


# Thread Views
class ThreadListCreateView(generics.ListCreateAPIView):
    """List threads in a subgroup or create a new thread."""

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self) -> type:
        if self.request.method == "POST":
            return ThreadCreateSerializer
        return ThreadSerializer

    def get_queryset(self) -> Any:
        subgroup = get_object_or_404(Subgroup, slug=self.kwargs["slug"])
        return (
            Thread.objects.filter(subgroup=subgroup)
            .select_related("author")
            .annotate(post_count_annotation=Count("posts"))
        )

    def get_serializer_context(self) -> dict:
        context = super().get_serializer_context()
        if self.request.method == "POST":
            context["subgroup"] = get_object_or_404(Subgroup, slug=self.kwargs["slug"])
        elif self.request.user.is_authenticated:
            subgroup = get_object_or_404(Subgroup, slug=self.kwargs["slug"])
            threads = Thread.objects.filter(subgroup=subgroup)
            read_map = dict(
                ThreadReadStatus.objects.filter(
                    user=self.request.user, thread__in=threads
                ).values_list("thread_id", "last_read_at")
            )
            unread_ids = set()
            for thread in threads:
                last_read = read_map.get(thread.id)
                if last_read is None or thread.updated_at > last_read:
                    unread_ids.add(thread.id)
            context["unread_thread_ids"] = unread_ids
            # Batch-load last post per thread (avoids N+1 in ThreadSerializer)
            latest_post_ids = (
                Post.objects.filter(thread__subgroup=subgroup)
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


class ThreadDeleteView(generics.DestroyAPIView):
    """Delete a thread (owner or admin)."""

    permission_classes = [permissions.IsAuthenticated, IsOwnerOrAdmin]
    queryset = Thread.objects.all()


class ThreadMoveView(APIView):
    """Move a thread to a different subgroup (owner or admin only)."""

    permission_classes = [permissions.IsAuthenticated, IsOwnerOrAdmin]

    def get_object(self, pk: int) -> Thread:
        obj = get_object_or_404(Thread, pk=pk)
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


class ThreadCloseView(APIView):
    """Close or reopen a thread (owner or admin only)."""

    permission_classes = [permissions.IsAuthenticated, IsOwnerOrAdmin]

    def get_object(self, pk: int) -> Thread:
        obj = get_object_or_404(Thread, pk=pk)
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
        """Override create to check if thread is closed."""
        thread = get_object_or_404(Thread, pk=self.kwargs["thread_id"])
        if thread.is_closed:
            return Response(
                {"detail": "Denne tråd er lukket og accepterer ikke længere nye svar."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer: Any) -> None:
        serializer.save()
        # Update thread's updated_at
        thread = get_object_or_404(Thread, pk=self.kwargs["thread_id"])
        thread.save(update_fields=["updated_at"])
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
        from apps.notifications.tasks import notify_mentions_task
        from apps.notifications.utils import extract_mention_ids

        old_content = serializer.instance.content or ""
        old_mention_ids = set(extract_mention_ids(old_content))

        serializer.save()

        post = serializer.instance
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
        queryset = Folder.objects.filter(subgroup=subgroup)
        if parent_id:
            queryset = queryset.filter(parent_id=parent_id)
        else:
            queryset = queryset.filter(parent__isnull=True)
        return queryset

    def get_serializer_context(self) -> dict:
        context = super().get_serializer_context()
        if self.request.method == "POST":
            context["subgroup"] = get_object_or_404(Subgroup, slug=self.kwargs["slug"])
        return context


class FolderDetailView(generics.RetrieveAPIView):
    """Get folder details with files."""

    serializer_class = FolderSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = Folder.objects.all()


class FolderBySlugView(generics.RetrieveAPIView):
    """Get folder by subgroup slug + folder slug."""

    serializer_class = FolderSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self) -> Folder:
        subgroup = get_object_or_404(Subgroup, slug=self.kwargs["slug"])
        return get_object_or_404(Folder, subgroup=subgroup, slug=self.kwargs["folder_slug"])


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
        return File.objects.filter(subgroup=subgroup, folder__isnull=True).select_related(
            "uploaded_by"
        )

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
        return File.objects.filter(folder=folder).select_related("uploaded_by")

    def get_serializer_context(self) -> dict:
        context = super().get_serializer_context()
        if self.request.method == "POST":
            folder = get_object_or_404(Folder, pk=self.kwargs["folder_id"])
            context["folder"] = folder
            context["subgroup"] = folder.subgroup
        return context


class FileDeleteView(generics.DestroyAPIView):
    """Delete a file (owner only)."""

    permission_classes = [permissions.IsAuthenticated, IsOwnerOrReadOnly]
    queryset = File.objects.all()

    def perform_destroy(self, instance: File) -> None:
        # Delete the actual file from storage
        if instance.file:
            instance.file.delete(save=False)
        instance.delete()


class FileMoveView(APIView):
    """Move a file to a different folder (owner or admin only)."""

    permission_classes = [permissions.IsAuthenticated, IsOwnerOrAdmin]

    def get_object(self, pk: int) -> File:
        obj = get_object_or_404(File, pk=pk)
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
        for file_obj in File.objects.filter(folder=folder):
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

        return Post.objects.select_related("author", "thread", "thread__subgroup").order_by(
            "-created_at"
        )[:limit]


class ReactionToggleView(APIView):
    """Toggle a reaction on a post."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, post_id: int) -> Response:
        """Add or remove a reaction from a post."""
        from apps.notifications.services import notify_post_reaction

        post = get_object_or_404(Post, pk=post_id)
        reaction_type = request.data.get("reaction_type")

        # Validate reaction type
        valid_types = [choice[0] for choice in Reaction.REACTION_CHOICES]
        if reaction_type not in valid_types:
            return Response(
                {"detail": f"Invalid reaction type. Must be one of: {valid_types}"},
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
                emoji_map = dict(Reaction.REACTION_CHOICES)
                notify_post_reaction(
                    post_author=post.author,
                    reactor=request.user,
                    thread_title=post.thread.title,
                    thread_id=post.thread.id,
                    subgroup_slug=post.thread.subgroup.slug,
                    thread_slug=post.thread.slug,
                    reaction_emoji=emoji_map.get(reaction_type, ""),
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
        """Return list of available reaction types with their emojis."""
        reaction_types = [
            {"type": choice[0], "emoji": choice[1]} for choice in Reaction.REACTION_CHOICES
        ]
        return Response(reaction_types)


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


# Read Status Views
class MarkAllForumReadView(APIView):
    """Mark all forum threads as read for the current user."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request) -> Response:
        from apps.notifications.models import Notification, NotificationType

        now = timezone.now()
        threads = Thread.objects.all()
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
        threads = Thread.objects.filter(subgroup=subgroup)
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
        subscribed_subgroup_ids = SubgroupSubscription.objects.filter(
            user=request.user
        ).values_list("subgroup_id", flat=True)
        read_map = dict(
            ThreadReadStatus.objects.filter(user=request.user).values_list(
                "thread_id", "last_read_at"
            )
        )
        count = 0
        for thread in Thread.objects.filter(subgroup_id__in=subscribed_subgroup_ids).only(
            "id", "updated_at"
        ):
            last_read = read_map.get(thread.id)
            if last_read is None or thread.updated_at > last_read:
                count += 1
        return Response({"unread_count": count})


class ThreadMuteToggleView(APIView):
    """Mute or unmute notifications for a specific thread."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        thread = get_object_or_404(Thread, pk=pk)
        mute, created = ThreadMuteStatus.objects.get_or_create(user=request.user, thread=thread)
        if not created:
            mute.delete()
            return Response({"is_muted": False})
        return Response({"is_muted": True})
