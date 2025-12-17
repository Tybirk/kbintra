"""
URL configuration for house endpoints.
"""

from django.urls import path

from .views import (
    ChildDetailView,
    ChildListCreateView,
    HouseDetailView,
    HouseListView,
    MyHouseView,
)

urlpatterns = [
    path("", HouseListView.as_view(), name="house-list"),
    path("my/", MyHouseView.as_view(), name="my-house"),
    path("my/children/", ChildListCreateView.as_view(), name="child-list-create"),
    path("my/children/<int:pk>/", ChildDetailView.as_view(), name="child-detail"),
    path("<int:pk>/", HouseDetailView.as_view(), name="house-detail"),
]
