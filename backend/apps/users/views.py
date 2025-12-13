"""
Views for User models.
"""

from typing import Any

from rest_framework import generics, permissions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Invitation, User
from .serializers import (
    InvitationCreateSerializer,
    InvitationSerializer,
    InvitationValidateSerializer,
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
    queryset = User.objects.filter(is_active=True).select_related("house")


class UserDetailView(generics.RetrieveAPIView):
    """
    Get details of a specific user.
    """

    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = User.objects.filter(is_active=True).select_related("house")


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
        return Invitation.objects.filter(created_by=self.request.user).select_related(
            "created_by"
        )
