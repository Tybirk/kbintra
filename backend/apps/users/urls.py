"""
URL configuration for user authentication endpoints.
"""

from django.urls import path

from .views import (
    ChangePasswordView,
    ConfirmEmailChangeView,
    DownloadDatabaseView,
    DownloadMediaView,
    ForgotPasswordView,
    InvitationListCreateView,
    RegisterView,
    RequestEmailChangeView,
    ResetPasswordView,
    ValidateInvitationView,
)

urlpatterns = [
    path("register/", RegisterView.as_view(), name="register"),
    path("validate-invitation/", ValidateInvitationView.as_view(), name="validate-invitation"),
    path("invitations/", InvitationListCreateView.as_view(), name="invitations"),
    path("change-password/", ChangePasswordView.as_view(), name="change-password"),
    path("forgot-password/", ForgotPasswordView.as_view(), name="forgot-password"),
    path("reset-password/", ResetPasswordView.as_view(), name="reset-password"),
    path("request-email-change/", RequestEmailChangeView.as_view(), name="request-email-change"),
    path("confirm-email-change/", ConfirmEmailChangeView.as_view(), name="confirm-email-change"),
    path("admin/download-db/", DownloadDatabaseView.as_view(), name="admin-download-db"),
    path("admin/download-media/", DownloadMediaView.as_view(), name="admin-download-media"),
]
