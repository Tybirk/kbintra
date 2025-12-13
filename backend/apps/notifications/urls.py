"""
URL configuration for notifications endpoints.
"""

from django.urls import path

from .views import (
    ClearAllNotificationsView,
    MarkNotificationsReadView,
    NotificationDetailView,
    NotificationListView,
    NotificationPreferenceView,
    UnreadNotificationCountView,
)

urlpatterns = [
    path("", NotificationListView.as_view(), name="notification-list"),
    path("<int:pk>/", NotificationDetailView.as_view(), name="notification-detail"),
    path("mark-read/", MarkNotificationsReadView.as_view(), name="notification-mark-read"),
    path("unread-count/", UnreadNotificationCountView.as_view(), name="notification-unread-count"),
    path("clear-all/", ClearAllNotificationsView.as_view(), name="notification-clear-all"),
    path("preferences/", NotificationPreferenceView.as_view(), name="notification-preferences"),
]
