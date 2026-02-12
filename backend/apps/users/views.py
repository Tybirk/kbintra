"""
Views for User models.
"""

from typing import Any

from django.db.models import Count, QuerySet
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Invitation, User
from .serializers import (
    ChangePasswordSerializer,
    ForgotPasswordSerializer,
    InvitationCreateSerializer,
    InvitationSerializer,
    InvitationValidateSerializer,
    ResetPasswordSerializer,
    UserProfileUpdateSerializer,
    UserRegistrationSerializer,
    UserSerializer,
)


class RegisterView(generics.CreateAPIView):
    """
    Register a new user with an invitation token.
    """

    serializer_class = UserRegistrationSerializer
    permission_classes = [permissions.AllowAny]

    def create(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response(
            {
                "message": "Registration successful",
                "user": UserSerializer(user).data,
            },
            status=status.HTTP_201_CREATED,
        )


class ValidateInvitationView(APIView):
    """
    Validate an invitation token and return invitation details.
    """

    permission_classes = [permissions.AllowAny]

    def post(self, request: Request) -> Response:
        serializer = InvitationValidateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        invitation = Invitation.objects.get(token=serializer.validated_data["token"])
        return Response(
            {
                "valid": True,
                "email": invitation.email,
                "expires_at": invitation.expires_at,
            }
        )


class CurrentUserView(generics.RetrieveUpdateAPIView):
    """
    Get or update the current user's profile.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self) -> type:
        if self.request.method in ["PUT", "PATCH"]:
            return UserProfileUpdateSerializer
        return UserSerializer

    def get_object(self) -> User:
        return self.request.user


class UserListView(generics.ListAPIView):
    """
    List all users in the community.
    """

    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None  # Small community (~90 users), no need for pagination
    queryset = (
        User.objects.filter(is_active=True)
        .select_related("house")
        .annotate(_house_inhabitant_count=Count("house__inhabitants"))
    )


class UserDetailView(generics.RetrieveAPIView):
    """
    Get details of a specific user.
    """

    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = User.objects.filter(is_active=True).select_related("house")


class UpcomingBirthdaysView(generics.ListAPIView):
    """
    List users with upcoming birthdays in the next N days.
    Returns users sorted by how soon their birthday is.
    """

    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None  # No pagination for this endpoint

    def get_queryset(self) -> QuerySet[User]:
        try:
            days = int(self.request.query_params.get("days", 7))
        except (ValueError, TypeError):
            days = 7
        days = min(days, 30)  # Cap at 30 days

        today = timezone.now().date()
        users_with_birthdays = []

        # Get all active users with birthdates
        users = User.objects.filter(is_active=True, birthdate__isnull=False).select_related("house")

        for user in users:
            # Calculate this year's birthday
            try:
                birthday_this_year = user.birthdate.replace(year=today.year)
            except ValueError:
                # Handle Feb 29 birthdays in non-leap years
                birthday_this_year = user.birthdate.replace(year=today.year, day=28)

            # If birthday has passed this year, check next year
            if birthday_this_year < today:
                try:
                    birthday_this_year = user.birthdate.replace(year=today.year + 1)
                except ValueError:
                    birthday_this_year = user.birthdate.replace(year=today.year + 1, day=28)

            days_until = (birthday_this_year - today).days

            if 0 <= days_until <= days:
                users_with_birthdays.append((user, days_until))

        # Sort by days until birthday
        users_with_birthdays.sort(key=lambda x: x[1])

        # Return just the users (sorted)
        return [u[0] for u in users_with_birthdays]


class InvitationListCreateView(generics.ListCreateAPIView):
    """
    List all invitations (for admins) or create a new invitation.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self) -> type:
        if self.request.method == "POST":
            return InvitationCreateSerializer
        return InvitationSerializer

    def get_queryset(self) -> Any:
        # All authenticated users can see invitations they created
        # Staff can see all invitations
        if self.request.user.is_staff:
            return Invitation.objects.all().select_related("created_by")
        return Invitation.objects.filter(created_by=self.request.user).select_related("created_by")


class ChangePasswordView(APIView):
    """
    Change password for authenticated users.
    Requires current password verification.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request) -> Response:
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"message": "Password changed successfully."})


class ForgotPasswordView(APIView):
    """
    Request a password reset email.
    Always returns success to prevent email enumeration.
    """

    permission_classes = [permissions.AllowAny]

    def post(self, request: Request) -> Response:
        serializer = ForgotPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        token = serializer.save()

        # Send email if token was created (user exists)
        if token:
            from django.conf import settings

            from apps.notifications.tasks import send_password_reset_email_task

            reset_url = f"{settings.SITE_URL}/reset-password?token={token.token}"
            send_password_reset_email_task(
                first_name=token.user.first_name,
                email=token.user.email,
                reset_url=reset_url,
            )

        # Always return success to prevent email enumeration
        return Response(
            {"message": "If an account exists with this email, a reset link has been sent."}
        )


class ResetPasswordView(APIView):
    """
    Reset password using a token from email.
    """

    permission_classes = [permissions.AllowAny]

    def post(self, request: Request) -> Response:
        serializer = ResetPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"message": "Password has been reset successfully."})
