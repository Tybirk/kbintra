"""
Views for Notifications app.
"""

from django.db.models import QuerySet
from rest_framework import generics, permissions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Notification, NotificationPreference
from .serializers import (
    MarkNotificationsReadSerializer,
    NotificationPreferenceSerializer,
    NotificationSerializer,
)


class NotificationListView(generics.ListAPIView):
    """List user's notifications."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = NotificationSerializer

    def get_queryset(self) -> QuerySet[Notification]:
        return (
            Notification.objects.filter(user=self.request.user)
            .select_related("related_user")
            .order_by("-created_at")
        )


class NotificationDetailView(generics.RetrieveDestroyAPIView):
    """Get or delete a notification."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = NotificationSerializer

    def get_queryset(self) -> QuerySet[Notification]:
        return Notification.objects.filter(user=self.request.user)


class MarkNotificationsReadView(APIView):
    """Mark notifications as read."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request) -> Response:
        serializer = MarkNotificationsReadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        notification_ids = serializer.validated_data.get("notification_ids", [])

        queryset = Notification.objects.filter(user=request.user, is_read=False)

        if notification_ids:
            queryset = queryset.filter(id__in=notification_ids)

        updated_count = queryset.update(is_read=True)

        return Response({"marked_read": updated_count})


class UnreadNotificationCountView(APIView):
    """Get total unread notification count for current user."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> Response:
        unread_count = Notification.objects.filter(
            user=request.user, is_read=False
        ).count()
        return Response({"unread_count": unread_count})


class NotificationPreferenceView(generics.RetrieveUpdateAPIView):
    """Get or update user's notification preferences."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = NotificationPreferenceSerializer

    def get_object(self) -> NotificationPreference:
        # Get or create preferences for the user
        preferences, _ = NotificationPreference.objects.get_or_create(
            user=self.request.user
        )
        return preferences


class ClearAllNotificationsView(APIView):
    """Clear all notifications for the current user."""

    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request: Request) -> Response:
        deleted_count, _ = Notification.objects.filter(user=request.user).delete()
        return Response({"deleted": deleted_count})
