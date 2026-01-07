"""
Views for Announcements app.
"""

from typing import Any

from rest_framework import generics, permissions

from .models import Announcement
from .serializers import AnnouncementCreateSerializer, AnnouncementSerializer


class IsOwnerOrReadOnly(permissions.BasePermission):
    """Custom permission to only allow owners to edit/delete."""

    def has_object_permission(
        self, request: Any, view: Any, obj: Announcement
    ) -> bool:
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
        return queryset


class AnnouncementDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Retrieve, update, or delete an announcement."""

    permission_classes = [permissions.IsAuthenticated, IsOwnerOrReadOnly]
    queryset = Announcement.objects.select_related("author").prefetch_related(
        "attachments__uploaded_by"
    )

    def get_serializer_class(self) -> type:
        if self.request.method in ["PUT", "PATCH"]:
            return AnnouncementCreateSerializer
        return AnnouncementSerializer
