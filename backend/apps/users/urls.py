"""
URL configuration for user authentication endpoints.
"""

from django.urls import path

from .views import (
    InvitationListCreateView,
    RegisterView,
    ValidateInvitationView,
)

urlpatterns = [
    path("register/", RegisterView.as_view(), name="register"),
    path("validate-invitation/", ValidateInvitationView.as_view(), name="validate-invitation"),
    path("invitations/", InvitationListCreateView.as_view(), name="invitations"),
]
