"""
URL configuration for announcements endpoints.
"""

from django.urls import path

from .views import (
    AnnouncementDashboardToggleView,
    AnnouncementDetailView,
    AnnouncementListCreateView,
)

urlpatterns = [
    path("", AnnouncementListCreateView.as_view(), name="announcement-list"),
    path("<int:pk>/", AnnouncementDetailView.as_view(), name="announcement-detail"),
    path(
        "<int:pk>/dashboard/",
        AnnouncementDashboardToggleView.as_view(),
        name="announcement-dashboard-toggle",
    ),
]
