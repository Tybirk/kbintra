"""
Views for Announcements app.
"""

from typing import Any

from rest_framework import generics, permissions

from .models import Announcement
from .serializers import AnnouncementCreateSerializer, AnnouncementSerializer


class IsOwnerOrReadOnly(permissions.BasePermission):
    """Custom permission to only allow owners or admins to edit/delete."""

    def has_object_permission(self, request: Any, view: Any, obj: Announcement) -> bool:
        if request.method in permissions.SAFE_METHODS:
            return True
        return obj.author == request.user or request.user.is_staff


class AnnouncementListCreateView(generics.ListCreateAPIView):
    """List all announcements or create a new one."""

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self) -> type:
        if self.request.method == "POST":
            return AnnouncementCreateSerializer
        return AnnouncementSerializer

    def get_queryset(self) -> Any:
        # By default only show active announcements
        queryset = Announcement.objects.select_related("author").prefetch_related(
            "attachments__uploaded_by"
        )
        # Allow filtering by is_active
        is_active = self.request.query_params.get("is_active")
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == "true")
        else:
            queryset = queryset.filter(is_active=True)
        # Allow filtering to only dashboard announcements
        dashboard_only = self.request.query_params.get("dashboard_only")
        if dashboard_only is not None and dashboard_only.lower() == "true":
            queryset = queryset.filter(show_on_dashboard=True)
        return queryset


class AnnouncementDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Retrieve, update, or delete an announcement."""

    permission_classes = [permissions.IsAuthenticated, IsOwnerOrReadOnly]
    queryset = Announcement.objects.select_related("author", "edited_by").prefetch_related(
        "attachments__uploaded_by"
    )

    def get_serializer_class(self) -> type:
        if self.request.method in ["PUT", "PATCH"]:
            return AnnouncementCreateSerializer
        return AnnouncementSerializer

    def perform_update(self, serializer: Any) -> None:
        # Capture old values before saving so we only notify on real content changes
        old_title = serializer.instance.title
        old_content = serializer.instance.content
        edited_by = (
            self.request.user if serializer.instance.author_id != self.request.user.id else None
        )
        announcement = serializer.save(edited_by=edited_by) if edited_by else serializer.save()

        content_changed = announcement.title != old_title or announcement.content != old_content
        if content_changed:
            from apps.notifications.tasks import notify_announcement_updated_task

            notify_announcement_updated_task(
                editor_id=self.request.user.id,
                announcement_title=announcement.title,
                announcement_id=announcement.id,
            )

        # Notify author when an admin edits their announcement
        if announcement.author_id != self.request.user.id and self.request.user.is_staff:
            from apps.notifications.tasks import notify_announcement_edited_by_admin_task

            notify_announcement_edited_by_admin_task(
                announcement_author_id=announcement.author_id,
                editor_id=self.request.user.id,
                announcement_title=announcement.title,
                announcement_id=announcement.id,
            )
