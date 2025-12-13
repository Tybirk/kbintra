"""
URL configuration for user profile endpoints.
"""

from django.urls import path

from .views import CurrentUserView, UserDetailView, UserListView

urlpatterns = [
    path("me/", CurrentUserView.as_view(), name="current-user"),
    path("", UserListView.as_view(), name="user-list"),
    path("<int:pk>/", UserDetailView.as_view(), name="user-detail"),
]
