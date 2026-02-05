"""
Views for Notifications app.
"""

import threading

from django.conf import settings
from django.db.models import QuerySet
from rest_framework import generics, permissions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Notification, NotificationPreference, NotificationType, PushSubscription
from .serializers import (
    MarkNotificationsReadSerializer,
    NotificationPreferenceSerializer,
    NotificationSerializer,
    PushSubscriptionInputSerializer,
    PushSubscriptionSerializer,
)
from .services import send_push_notification


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
        unread_count = Notification.objects.filter(user=request.user, is_read=False).count()
        return Response({"unread_count": unread_count})


class NotificationPreferenceView(generics.RetrieveUpdateAPIView):
    """Get or update user's notification preferences."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = NotificationPreferenceSerializer

    def get_object(self) -> NotificationPreference:
        # Get or create preferences for the user
        preferences, _ = NotificationPreference.objects.get_or_create(user=self.request.user)
        return preferences


class ClearAllNotificationsView(APIView):
    """Clear all notifications for the current user."""

    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request: Request) -> Response:
        deleted_count, _ = Notification.objects.filter(user=request.user).delete()
        return Response({"deleted": deleted_count})


class VapidPublicKeyView(APIView):
    """Get VAPID public key for Web Push subscription."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> Response:
        public_key = getattr(settings, "VAPID_PUBLIC_KEY", None)
        if not public_key:
            return Response(
                {"error": "Web Push not configured"},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        return Response({"public_key": public_key})


class PushSubscriptionView(APIView):
    """Manage Web Push subscriptions."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> Response:
        """List user's push subscriptions."""
        subscriptions = PushSubscription.objects.filter(user=request.user)
        serializer = PushSubscriptionSerializer(subscriptions, many=True)
        return Response(serializer.data)

    def post(self, request: Request) -> Response:
        """Subscribe to push notifications."""
        serializer = PushSubscriptionInputSerializer(
            data=request.data, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        subscription = serializer.save()

        return Response(
            PushSubscriptionSerializer(subscription).data,
            status=status.HTTP_201_CREATED,
        )

    def delete(self, request: Request) -> Response:
        """Unsubscribe from push notifications."""
        endpoint = request.data.get("endpoint")
        if not endpoint:
            return Response(
                {"error": "Endpoint is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        deleted_count, _ = PushSubscription.objects.filter(
            user=request.user, endpoint=endpoint
        ).delete()

        if deleted_count == 0:
            return Response(
                {"error": "Subscription not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(status=status.HTTP_204_NO_CONTENT)


class TestPushNotificationView(APIView):
    """Send a test push notification to the current user for debugging."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request) -> Response:
        # Check if push is configured
        vapid_private_key = getattr(settings, "VAPID_PRIVATE_KEY", None)
        if not vapid_private_key:
            return Response(
                {
                    "error": "VAPID_PRIVATE_KEY not configured",
                    "configured": False,
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        # Get user's subscriptions for debug info
        subscriptions = PushSubscription.objects.filter(user=request.user)
        subscription_count = subscriptions.count()

        if subscription_count == 0:
            return Response(
                {
                    "error": "No push subscriptions found for this user",
                    "subscription_count": 0,
                    "configured": True,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check for delay parameter (in seconds)
        delay = request.data.get("delay", 0)
        try:
            delay = int(delay)
            if delay < 0 or delay > 60:
                delay = 0  # Cap at 60 seconds for safety
        except (ValueError, TypeError):
            delay = 0

        user_id = request.user.id

        def send_delayed_notification() -> None:
            from django.contrib.auth import get_user_model

            user_model = get_user_model()
            try:
                user = user_model.objects.get(id=user_id)
                send_push_notification(
                    user=user,
                    notification_type=NotificationType.NEW_MESSAGE,
                    title="Test Push Notification (Delayed)",
                    message="This is a delayed test notification to verify push is working.",
                    link="/notifikationer",
                )
            except user_model.DoesNotExist:
                pass

        if delay > 0:
            # Schedule the notification to be sent after delay
            timer = threading.Timer(delay, send_delayed_notification)
            timer.start()
            return Response(
                {
                    "configured": True,
                    "scheduled": True,
                    "delay": delay,
                    "subscription_count": subscription_count,
                    "message": f"Push notification scheduled to be sent in {delay} seconds",
                }
            )

        # Send test notification immediately (bypass preferences check)
        result = send_push_notification(
            user=request.user,
            notification_type=NotificationType.NEW_MESSAGE,  # Use message type
            title="Test Push Notification",
            message="This is a test notification to verify push is working.",
            link="/notifikationer",
        )

        return Response(
            {
                "configured": True,
                "subscription_count": subscription_count,
                "subscriptions": [
                    {
                        "id": sub.id,
                        "endpoint_domain": sub.endpoint.split("/")[2]
                        if "/" in sub.endpoint
                        else sub.endpoint[:50],
                        "created_at": sub.created_at.isoformat(),
                    }
                    for sub in subscriptions
                ],
                "result": result,
            }
        )
