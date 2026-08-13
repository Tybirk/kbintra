"""
Views for Notifications app.
"""

from django.conf import settings
from django.db.models import QuerySet
from rest_framework import generics, permissions, status
from rest_framework.pagination import PageNumberPagination
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


class NotificationPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200


class NotificationListView(generics.ListAPIView):
    """List user's notifications."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = NotificationSerializer
    pagination_class = NotificationPagination

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


class MarkNotificationsUnreadView(APIView):
    """Mark notifications as unread."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request) -> Response:
        notification_ids = request.data.get("notification_ids", [])

        queryset = Notification.objects.filter(user=request.user, is_read=True)

        if notification_ids:
            queryset = queryset.filter(id__in=notification_ids)

        updated_count = queryset.update(is_read=False)

        return Response({"marked_unread": updated_count})


class MarkNotificationsByLinkView(APIView):
    """Mark unread notifications for a specific link path as read."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request) -> Response:
        from urllib.parse import unquote

        from django.db.models import Q

        # URL-decode the link: browsers send percent-encoded paths (e.g. %C3%A6 for æ)
        # but notification links are stored with the decoded Unicode form.
        link = unquote(request.data.get("link", ""))
        if not link:
            return Response({"marked_read": 0})

        updated_count = (
            Notification.objects.filter(user=request.user, is_read=False)
            .filter(Q(link=link) | Q(link__startswith=f"{link}#"))
            .update(is_read=True)
        )
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
    """Get VAPID public key for Web Push subscription.

    Returns 200 with `public_key: null` when push is not configured. We avoid
    503 here on purpose: 503 is conventionally reserved for "service is briefly
    down" and would be (rightly) interpreted by the frontend's API layer as a
    deploy/maintenance signal. "Push not configured" is a permanent app state,
    not a transient outage.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> Response:
        public_key = getattr(settings, "VAPID_PUBLIC_KEY", None)
        return Response({"public_key": public_key or None})


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

        response_status = (
            status.HTTP_201_CREATED
            if getattr(subscription, "_was_created", False)
            else status.HTTP_200_OK
        )
        return Response(
            PushSubscriptionSerializer(subscription).data,
            status=response_status,
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
                {"error": "Abonnementet blev ikke fundet."},
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
                    "error": "Der er ikke registreret nogen push-abonnementer for din bruger.",
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

        if delay > 0:
            from .tasks import send_push_task

            # Schedule the notification to be sent after delay
            send_push_task.schedule(
                args=(
                    request.user.id,
                    NotificationType.NEW_MESSAGE,
                    "Test Push Notification (Delayed)",
                    "This is a delayed test notification to verify push is working.",
                    "/notifikationer",
                ),
                delay=delay,
            )
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
