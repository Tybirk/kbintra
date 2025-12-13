"""
URL configuration for announcements endpoints.
"""

from django.urls import path

from .views import AnnouncementDetailView, AnnouncementListCreateView

urlpatterns = [
    path("", AnnouncementListCreateView.as_view(), name="announcement-list"),
    path("<int:pk>/", AnnouncementDetailView.as_view(), name="announcement-detail"),
]
