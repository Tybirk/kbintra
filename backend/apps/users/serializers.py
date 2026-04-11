"""
Serializers for User models.
"""

from typing import Any

from django.contrib.auth.password_validation import validate_password
from django.utils import timezone
from rest_framework import serializers

from .models import EmailChangeToken, Invitation, PasswordResetToken, User


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
            "is_food_admin",
            "date_joined",
            "default_cooking_days",
            "accessibility_mode",
        ]
        read_only_fields = ["id", "email", "is_staff", "is_food_admin", "date_joined"]

    def get_house_inhabitant_count(self, obj: User) -> int:
        """Get the number of inhabitants in the user's house."""
        # Use annotated value if available (avoids N+1 queries)
        if hasattr(obj, "_house_inhabitant_count"):
            return obj._house_inhabitant_count
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
            "accessibility_mode",
        ]
        read_only_fields = ["house"]


class MentionUserSerializer(serializers.ModelSerializer):
    """Minimal serializer for @mention user search."""

    class Meta:
        model = User
        fields = ["id", "first_name", "last_name", "profile_picture"]


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
        except Invitation.DoesNotExist as err:
            raise serializers.ValidationError("Invalid invitation token.") from err

        if not invitation.is_valid:
            raise serializers.ValidationError("This invitation has expired or already been used.")

        return value

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        """Validate that passwords match and email matches invitation."""
        if attrs["password"] != attrs["password_confirm"]:
            raise serializers.ValidationError({"password_confirm": "Passwords do not match."})

        # Verify email matches the invitation
        invitation = Invitation.objects.get(token=attrs["token"])
        if invitation.email.lower() != attrs["email"].lower():
            raise serializers.ValidationError({"email": "Email does not match the invitation."})

        # Check email is not already registered
        if User.objects.filter(email__iexact=attrs["email"]).exists():
            raise serializers.ValidationError({"email": "A user with this email already exists."})

        return attrs

    def create(self, validated_data: dict[str, Any]) -> User:
        """Create the user and mark invitation as used."""
        from django.db import transaction

        from apps.forum.models import Subgroup, SubgroupSubscription

        with transaction.atomic():
            # Re-fetch invitation with lock to prevent race conditions
            invitation = Invitation.objects.select_for_update().get(token=validated_data["token"])
            if not invitation.is_valid:
                raise serializers.ValidationError(
                    {"token": "This invitation has already been used."}
                )

            user = User.objects.create_user(
                email=validated_data["email"],
                password=validated_data["password"],
                first_name=validated_data["first_name"],
                last_name=validated_data["last_name"],
                house=invitation.house,  # Assign user to the house from invitation
            )

            # Mark invitation as used
            invitation.mark_used()

            # Subscribe to default forum subgroups using bulk_create
            default_subgroups = Subgroup.objects.filter(is_default=True)
            subscriptions = [
                SubgroupSubscription(user=user, subgroup=subgroup) for subgroup in default_subgroups
            ]
            SubgroupSubscription.objects.bulk_create(subscriptions)

        return user


class InvitationSerializer(serializers.ModelSerializer):
    """Serializer for Invitation model."""

    created_by_name = serializers.CharField(source="created_by.get_full_name", read_only=True)
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
            raise serializers.ValidationError("A user with this email already exists.")

        # Check for pending valid invitation
        pending = Invitation.objects.filter(email__iexact=value, used_at__isnull=True).first()
        if pending and pending.is_valid:
            raise serializers.ValidationError("A valid invitation already exists for this email.")

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
        except Invitation.DoesNotExist as err:
            raise serializers.ValidationError("Invalid invitation token.") from err

        if not invitation.is_valid:
            raise serializers.ValidationError("This invitation has expired or already been used.")

        return value


class ChangePasswordSerializer(serializers.Serializer):
    """Serializer for authenticated password change."""

    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, validators=[validate_password])
    new_password_confirm = serializers.CharField(write_only=True)

    def validate_current_password(self, value: str) -> str:
        """Validate that the current password is correct."""
        user = self.context["request"].user
        if not user.check_password(value):
            raise serializers.ValidationError("Current password is incorrect.")
        return value

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        """Validate that new passwords match."""
        if attrs["new_password"] != attrs["new_password_confirm"]:
            raise serializers.ValidationError(
                {"new_password_confirm": "New passwords do not match."}
            )
        return attrs

    def save(self) -> User:
        """Update the user's password."""
        user = self.context["request"].user
        user.set_password(self.validated_data["new_password"])
        user.save(update_fields=["password"])
        return user


class ForgotPasswordSerializer(serializers.Serializer):
    """Serializer for requesting a password reset."""

    email = serializers.EmailField()

    def validate_email(self, value: str) -> str:
        """Normalize email (don't reveal if user exists)."""
        return value.lower()

    def save(self) -> PasswordResetToken | None:
        """Create a password reset token if user exists."""
        email = self.validated_data["email"]
        try:
            user = User.objects.get(email__iexact=email)
            # Invalidate any existing tokens for this user
            PasswordResetToken.objects.filter(user=user, used_at__isnull=True).update(
                used_at=timezone.now()
            )
            # Create new token
            token = PasswordResetToken.objects.create(user=user)
            return token
        except User.DoesNotExist:
            # Don't reveal that the user doesn't exist
            return None


class RequestEmailChangeSerializer(serializers.Serializer):
    """Serializer for requesting an email change."""

    new_email = serializers.EmailField()
    current_password = serializers.CharField(write_only=True)

    def validate_current_password(self, value: str) -> str:
        """Validate that the current password is correct."""
        user = self.context["request"].user
        if not user.check_password(value):
            raise serializers.ValidationError("Adgangskoden er forkert.")
        return value

    def validate_new_email(self, value: str) -> str:
        """Validate the new email is not already in use."""
        value = value.lower()
        user = self.context["request"].user
        if value == user.email.lower():
            raise serializers.ValidationError(
                "Den nye emailadresse er den samme som din nuværende."
            )
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("Denne emailadresse er allerede i brug.")
        return value

    def save(self) -> EmailChangeToken:
        """Invalidate old tokens and create a new one."""
        user = self.context["request"].user
        new_email = self.validated_data["new_email"]
        # Invalidate any existing pending tokens for this user
        EmailChangeToken.objects.filter(user=user, used_at__isnull=True).update(
            used_at=timezone.now()
        )
        return EmailChangeToken.objects.create(user=user, new_email=new_email)


class ConfirmEmailChangeSerializer(serializers.Serializer):
    """Serializer for confirming email change with a token."""

    token = serializers.CharField(write_only=True)

    def validate_token(self, value: str) -> str:
        """Validate the token exists, is valid, and the new email is still free."""
        try:
            email_token = EmailChangeToken.objects.get(token=value)
        except EmailChangeToken.DoesNotExist as err:
            raise serializers.ValidationError("Ugyldigt eller udløbet token.") from err

        if not email_token.is_valid:
            raise serializers.ValidationError("Dette token er udløbet eller allerede brugt.")

        if User.objects.filter(email__iexact=email_token.new_email).exists():
            raise serializers.ValidationError("Denne emailadresse er ikke længere tilgængelig.")

        return value

    def save(self) -> User:
        """Update the user's email atomically and mark token as used."""
        from django.db import transaction

        with transaction.atomic():
            email_token = EmailChangeToken.objects.select_for_update().get(
                token=self.validated_data["token"]
            )
            if not email_token.is_valid:
                raise serializers.ValidationError({"token": "Dette token er allerede brugt."})
            user = email_token.user
            user.email = email_token.new_email
            user.save(update_fields=["email"])
            email_token.mark_used()
        return user


class ResetPasswordSerializer(serializers.Serializer):
    """Serializer for resetting password with a token."""

    token = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, validators=[validate_password])
    new_password_confirm = serializers.CharField(write_only=True)

    def validate_token(self, value: str) -> str:
        """Validate that the token exists and is valid."""
        try:
            reset_token = PasswordResetToken.objects.get(token=value)
        except PasswordResetToken.DoesNotExist as err:
            raise serializers.ValidationError("Invalid or expired reset token.") from err

        if not reset_token.is_valid:
            raise serializers.ValidationError("This reset token has expired or already been used.")

        return value

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        """Validate that passwords match."""
        if attrs["new_password"] != attrs["new_password_confirm"]:
            raise serializers.ValidationError({"new_password_confirm": "Passwords do not match."})
        return attrs

    def save(self) -> User:
        """Reset the user's password and mark token as used."""
        reset_token = PasswordResetToken.objects.get(token=self.validated_data["token"])
        user = reset_token.user
        user.set_password(self.validated_data["new_password"])
        user.save(update_fields=["password"])
        reset_token.mark_used()
        return user
