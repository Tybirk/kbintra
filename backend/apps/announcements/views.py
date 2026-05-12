"""
Views for Announcements app.
"""

from typing import Any

from django.shortcuts import get_object_or_404
from rest_framework import generics, permissions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Announcement
from .serializers import AnnouncementCreateSerializer, AnnouncementSerializer


class IsOwnerOrReadOnly(permissions.BasePermission):
    """Custom permission to only allow owners to edit/delete."""

    def has_object_permission(self, request: Any, view: Any, obj: Announcement) -> bool:
        if request.method in permissions.SAFE_METHODS:
            return True
        return obj.author == request.user


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
        announcement = serializer.save()

        content_changed = announcement.title != old_title or announcement.content != old_content
        if content_changed:
            from apps.notifications.tasks import notify_announcement_updated_task

            notify_announcement_updated_task(
                editor_id=self.request.user.id,
                announcement_title=announcement.title,
                announcement_id=announcement.id,
            )


class AnnouncementDashboardToggleView(APIView):
    """Toggle whether an announcement appears on the dashboard (owner or admin).

    Admins keep the right to curate what is shown on the front page even though
    they cannot edit or delete others' announcements.
    """

    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request: Request, pk: int) -> Response:
        announcement = get_object_or_404(Announcement, pk=pk)
        if announcement.author_id != request.user.id and not request.user.is_staff:
            return Response(
                {"detail": "Du har ikke tilladelse til at ændre dette opslag."},
                status=status.HTTP_403_FORBIDDEN,
            )
        show = request.data.get("show_on_dashboard")
        if show is None:
            return Response(
                {"detail": "show_on_dashboard er påkrævet."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        announcement.show_on_dashboard = bool(show)
        announcement.save(update_fields=["show_on_dashboard"])
        return Response(AnnouncementSerializer(announcement, context={"request": request}).data)
