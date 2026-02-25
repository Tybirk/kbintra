"""
URL configuration for notifications endpoints.
"""

from django.urls import path

from .views import (
    ClearAllNotificationsView,
    MarkNotificationsByLinkView,
    MarkNotificationsReadView,
    MarkNotificationsUnreadView,
    NotificationDetailView,
    NotificationListView,
    NotificationPreferenceView,
    PushSubscriptionView,
    TestPushNotificationView,
    UnreadNotificationCountView,
    VapidPublicKeyView,
)

urlpatterns = [
    path("", NotificationListView.as_view(), name="notification-list"),
    path("<int:pk>/", NotificationDetailView.as_view(), name="notification-detail"),
    path("mark-read/", MarkNotificationsReadView.as_view(), name="notification-mark-read"),
    path("mark-unread/", MarkNotificationsUnreadView.as_view(), name="notification-mark-unread"),
    path(
        "mark-read-by-link/",
        MarkNotificationsByLinkView.as_view(),
        name="notification-mark-read-by-link",
    ),
    path("unread-count/", UnreadNotificationCountView.as_view(), name="notification-unread-count"),
    path("clear-all/", ClearAllNotificationsView.as_view(), name="notification-clear-all"),
    path("preferences/", NotificationPreferenceView.as_view(), name="notification-preferences"),
    # Push notifications
    path("push/vapid-key/", VapidPublicKeyView.as_view(), name="push-vapid-key"),
    path("push/subscribe/", PushSubscriptionView.as_view(), name="push-subscribe"),
    path("push/test/", TestPushNotificationView.as_view(), name="push-test"),
]
