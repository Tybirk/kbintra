"""
URL configuration for user profile endpoints.
"""

from django.urls import path

from .views import (
    CurrentUserView,
    UpcomingBirthdaysView,
    UserDetailView,
    UserListView,
    UserMentionListView,
)

urlpatterns = [
    path("me/", CurrentUserView.as_view(), name="current-user"),
    path("birthdays/", UpcomingBirthdaysView.as_view(), name="upcoming-birthdays"),
    path("mentions/", UserMentionListView.as_view(), name="user-mentions"),
    path("", UserListView.as_view(), name="user-list"),
    path("<int:pk>/", UserDetailView.as_view(), name="user-detail"),
]
