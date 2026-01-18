"""
Views for Calendar app.
"""

from datetime import datetime
from typing import Any

from django.db.models import QuerySet
from django.utils import timezone
from rest_framework import generics, permissions

from .models import Event
from .serializers import EventCreateUpdateSerializer, EventSerializer


class IsOwnerOrReadOnly(permissions.BasePermission):
    """Custom permission to only allow owners to edit/delete."""

    def has_object_permission(self, request: Any, view: Any, obj: Event) -> bool:
        if request.method in permissions.SAFE_METHODS:
            return True
        return obj.created_by == request.user


class EventListCreateView(generics.ListCreateAPIView):
    """List all events or create a new one."""

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self) -> type:
        if self.request.method == "POST":
            return EventCreateUpdateSerializer
        return EventSerializer

    def get_queryset(self) -> QuerySet[Event]:
        queryset = Event.objects.select_related("created_by")

        # Filter by date range if provided
        start = self.request.query_params.get("start")
        end = self.request.query_params.get("end")

        if start:
            try:
                start_date = datetime.fromisoformat(start.replace("Z", "+00:00"))
                queryset = queryset.filter(start_datetime__gte=start_date)
            except ValueError:
                pass

        if end:
            try:
                end_date = datetime.fromisoformat(end.replace("Z", "+00:00"))
                queryset = queryset.filter(start_datetime__lte=end_date)
            except ValueError:
                pass

        return queryset


class EventDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Retrieve, update, or delete an event."""

    permission_classes = [permissions.IsAuthenticated, IsOwnerOrReadOnly]
    queryset = Event.objects.select_related("created_by")

    def get_serializer_class(self) -> type:
        if self.request.method in ["PUT", "PATCH"]:
            return EventCreateUpdateSerializer
        return EventSerializer


class UpcomingEventsView(generics.ListAPIView):
    """List upcoming events (for dashboard widget)."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = EventSerializer

    def get_queryset(self) -> QuerySet[Event]:
        now = timezone.now()
        # Get events starting from now, limit to 5
        return Event.objects.filter(start_datetime__gte=now).select_related("created_by")[:5]
