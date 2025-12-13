"""
Serializers for User models.
"""

from typing import Any

from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from apps.houses.models import House

from .models import Invitation, User


class UserSerializer(serializers.ModelSerializer):
    """Serializer for User model (read operations)."""

    house_name = serializers.CharField(source="house.name", read_only=True)
    house_inhabitant_count = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "first_name",
            "last_name",
            "phone_number",
            "birthdate",
            "profile_picture",
            "bio",
            "house",
            "house_name",
            "house_inhabitant_count",
            "is_staff",
            "date_joined",
        ]
        read_only_fields = ["id", "email", "is_staff", "date_joined"]

    def get_house_inhabitant_count(self, obj: User) -> int:
        """Get the number of inhabitants in the user's house."""
        if obj.house:
            return obj.house.inhabitants.count()
        return 0


class UserProfileUpdateSerializer(serializers.ModelSerializer):
    """Serializer for updating user profile."""

    class Meta:
        model = User
        fields = [
            "first_name",
            "last_name",
            "phone_number",
            "birthdate",
            "profile_picture",
            "bio",
            "house",
        ]


class UserRegistrationSerializer(serializers.Serializer):
    """Serializer for user registration with invitation token."""

    token = serializers.CharField(write_only=True)
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, validators=[validate_password])
    password_confirm = serializers.CharField(write_only=True)
    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150)

    def validate_token(self, value: str) -> str:
        """Validate that the invitation token exists and is valid."""
        try:
            invitation = Invitation.objects.get(token=value)
        except Invitation.DoesNotExist:
            raise serializers.ValidationError("Invalid invitation token.")

        if not invitation.is_valid:
            raise serializers.ValidationError(
                "This invitation has expired or already been used."
            )

        return value

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        """Validate that passwords match and email matches invitation."""
        if attrs["password"] != attrs["password_confirm"]:
            raise serializers.ValidationError(
                {"password_confirm": "Passwords do not match."}
            )

        # Verify email matches the invitation
        invitation = Invitation.objects.get(token=attrs["token"])
        if invitation.email.lower() != attrs["email"].lower():
            raise serializers.ValidationError(
                {"email": "Email does not match the invitation."}
            )

        # Check email is not already registered
        if User.objects.filter(email__iexact=attrs["email"]).exists():
            raise serializers.ValidationError(
                {"email": "A user with this email already exists."}
            )

        return attrs

    def create(self, validated_data: dict[str, Any]) -> User:
        """Create the user and mark invitation as used."""
        invitation = Invitation.objects.get(token=validated_data["token"])

        user = User.objects.create_user(
            email=validated_data["email"],
            password=validated_data["password"],
            first_name=validated_data["first_name"],
            last_name=validated_data["last_name"],
            house=invitation.house,  # Assign user to the house from invitation
        )

        # Mark invitation as used
        invitation.mark_used()

        # Subscribe to default forum subgroups
        from apps.forum.models import Subgroup, SubgroupSubscription

        default_subgroups = Subgroup.objects.filter(is_default=True)
        for subgroup in default_subgroups:
            SubgroupSubscription.objects.create(user=user, subgroup=subgroup)

        return user


class InvitationSerializer(serializers.ModelSerializer):
    """Serializer for Invitation model."""

    created_by_name = serializers.CharField(
        source="created_by.get_full_name", read_only=True
    )
    house_name = serializers.CharField(source="house.name", read_only=True)
    is_valid = serializers.BooleanField(read_only=True)

    class Meta:
        model = Invitation
        fields = [
            "id",
            "email",
            "token",
            "house",
            "house_name",
            "created_by",
            "created_by_name",
            "created_at",
            "used_at",
            "expires_at",
            "is_valid",
        ]
        read_only_fields = ["id", "token", "created_by", "created_at", "used_at"]


class InvitationCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating invitations."""

    class Meta:
        model = Invitation
        fields = ["email", "house"]

    def validate_email(self, value: str) -> str:
        """Check if email is already registered or has pending invitation."""
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError(
                "A user with this email already exists."
            )

        # Check for pending valid invitation
        pending = Invitation.objects.filter(
            email__iexact=value, used_at__isnull=True
        ).first()
        if pending and pending.is_valid:
            raise serializers.ValidationError(
                "A valid invitation already exists for this email."
            )

        return value

    def create(self, validated_data: dict[str, Any]) -> Invitation:
        """Create invitation with the current user as creator."""
        validated_data["created_by"] = self.context["request"].user
        return super().create(validated_data)


class InvitationValidateSerializer(serializers.Serializer):
    """Serializer for validating an invitation token."""

    token = serializers.CharField()

    def validate_token(self, value: str) -> str:
        """Validate the invitation token."""
        try:
            invitation = Invitation.objects.get(token=value)
        except Invitation.DoesNotExist:
            raise serializers.ValidationError("Invalid invitation token.")

        if not invitation.is_valid:
            raise serializers.ValidationError(
                "This invitation has expired or already been used."
            )

        return value
