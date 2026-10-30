"""
URL configuration for house endpoints.
"""

from django.urls import path

from .views import (
    CarDetailView,
    CarListCreateView,
    ChildDetailView,
    ChildListCreateView,
    HandoverDetailView,
    HandoverInvitationPreviewView,
    HandoverInvitationResendView,
    HandoverListCreateView,
    HouseDetailView,
    HouseListView,
    MyHouseView,
)

urlpatterns = [
    path("", HouseListView.as_view(), name="house-list"),
    path("my/", MyHouseView.as_view(), name="my-house"),
    path("my/children/", ChildListCreateView.as_view(), name="child-list-create"),
    path("my/children/<int:pk>/", ChildDetailView.as_view(), name="child-detail"),
    path("my/cars/", CarListCreateView.as_view(), name="car-list-create"),
    path("my/cars/<int:pk>/", CarDetailView.as_view(), name="car-detail"),
    path("handovers/", HandoverListCreateView.as_view(), name="handover-list"),
    path("handovers/<int:pk>/", HandoverDetailView.as_view(), name="handover-detail"),
    path(
        "handovers/invitations/<int:pk>/resend/",
        HandoverInvitationResendView.as_view(),
        name="handover-invitation-resend",
    ),
    path(
        "handovers/invitation-preview/",
        HandoverInvitationPreviewView.as_view(),
        name="handover-invitation-preview",
    ),
    path("<slug:slug>/", HouseDetailView.as_view(), name="house-detail"),
]
