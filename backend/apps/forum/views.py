"""
Views for Forum models.
"""

from typing import Any

from django.shortcuts import get_object_or_404
from rest_framework import generics, permissions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import File, Folder, Post, Reaction, Subgroup, SubgroupSubscription, Thread
from .serializers import (
    FileSerializer,
    FileUploadSerializer,
    FolderCreateSerializer,
    FolderSerializer,
    PostCreateSerializer,
    PostSerializer,
    RecentActivitySerializer,
    SubgroupSerializer,
    SubgroupSubscriptionSerializer,
    ThreadCreateSerializer,
    ThreadDetailSerializer,
    ThreadSerializer,
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
class SubgroupListView(generics.ListAPIView):
    """List all subgroups."""

    serializer_class = SubgroupSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = Subgroup.objects.all()


class SubgroupDetailView(generics.RetrieveAPIView):
    """Get subgroup details."""

    serializer_class = SubgroupSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = Subgroup.objects.all()
    lookup_field = "slug"


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
        return Thread.objects.filter(subgroup=subgroup).select_related("author")

    def get_serializer_context(self) -> dict:
        context = super().get_serializer_context()
        if self.request.method == "POST":
            context["subgroup"] = get_object_or_404(Subgroup, slug=self.kwargs["slug"])
        return context


class ThreadDetailView(generics.RetrieveAPIView):
    """Get thread details with all posts."""

    serializer_class = ThreadDetailSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = Thread.objects.prefetch_related(
        "posts__author", "posts__attachments__uploaded_by", "posts__reactions"
    ).select_related("author", "subgroup")


class ThreadDeleteView(generics.DestroyAPIView):
    """Delete a thread (owner only)."""

    permission_classes = [permissions.IsAuthenticated, IsOwnerOrReadOnly]
    queryset = Thread.objects.all()


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
            .prefetch_related("attachments__uploaded_by", "reactions")
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


class PostUpdateDeleteView(generics.RetrieveUpdateDestroyAPIView):
    """Update or delete a post (owner only)."""

    serializer_class = PostSerializer
    permission_classes = [permissions.IsAuthenticated, IsOwnerOrReadOnly]
    queryset = Post.objects.prefetch_related("attachments__uploaded_by").all()

    def get_serializer_class(self) -> type:
        if self.request.method in ["PUT", "PATCH"]:
            return PostCreateSerializer
        return PostSerializer


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
                    reaction_emoji=emoji_map.get(reaction_type, ""),
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
