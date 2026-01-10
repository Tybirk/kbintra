"""
Tests for the Users app.
"""

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.users.models import Invitation, PasswordResetToken, User


@pytest.fixture
def invitation(db, user, house):
    """Create a test invitation."""
    return Invitation.objects.create(
        email="newuser@example.com",
        house=house,
        created_by=user,
        expires_at=timezone.now() + timedelta(days=7),
    )


@pytest.fixture
def expired_invitation(db, user, house):
    """Create an expired invitation."""
    return Invitation.objects.create(
        email="expired@example.com",
        house=house,
        created_by=user,
        expires_at=timezone.now() - timedelta(days=1),
    )


# =============================================================================
# Model Tests
# =============================================================================


class TestUserModel:
    """Tests for the User model."""

    def test_user_str(self, user):
        """Test string representation of user."""
        # User __str__ returns full name if available, otherwise email
        result = str(user)
        assert user.first_name in result or user.email in result

    def test_user_full_name(self, user):
        """Test user full name property."""
        assert user.first_name in user.get_full_name()

    def test_create_superuser(self, db):
        """Test creating a superuser."""
        admin = User.objects.create_superuser(
            email="superadmin@example.com",
            password="adminpass",
        )
        assert admin.is_staff is True
        assert admin.is_superuser is True


class TestInvitationModel:
    """Tests for the Invitation model."""

    def test_invitation_str(self, invitation):
        """Test string representation of invitation."""
        assert "newuser@example.com" in str(invitation)

    def test_invitation_has_token(self, invitation):
        """Test that invitation has a token."""
        assert invitation.token is not None
        assert len(invitation.token) > 0


# =============================================================================
# API Tests
# =============================================================================


class TestUserAPI:
    """Tests for the User API endpoints."""

    def test_list_users_unauthenticated(self, api_client):
        """Test that unauthenticated users cannot list users."""
        response = api_client.get("/api/users/")
        assert response.status_code == 401

    def test_list_users(self, authenticated_client, user, second_user):
        """Test listing users."""
        response = authenticated_client.get("/api/users/")
        assert response.status_code == 200

        data = response.json()
        results = data.get("results", data)
        assert len(results) >= 2

    def test_get_user_detail(self, authenticated_client, second_user):
        """Test getting user details."""
        response = authenticated_client.get(f"/api/users/{second_user.id}/")
        assert response.status_code == 200
        assert response.json()["email"] == second_user.email


class TestCurrentUserAPI:
    """Tests for the Current User API endpoint."""

    def test_get_current_user(self, authenticated_client, user):
        """Test getting current user profile."""
        response = authenticated_client.get("/api/users/me/")
        assert response.status_code == 200
        assert response.json()["email"] == user.email

    def test_update_current_user(self, authenticated_client, user):
        """Test updating current user profile."""
        response = authenticated_client.patch(
            "/api/users/me/",
            {"first_name": "Updated"},
            format="json",
        )
        assert response.status_code == 200
        user.refresh_from_db()
        assert user.first_name == "Updated"


class TestInvitationAPI:
    """Tests for the Invitation API endpoints."""

    def test_list_own_invitations(self, authenticated_client, invitation):
        """Test listing own invitations."""
        response = authenticated_client.get("/api/auth/invitations/")
        assert response.status_code == 200

        data = response.json()
        results = data.get("results", data) if isinstance(data, dict) else data
        assert len(results) == 1

    def test_create_invitation(self, authenticated_client, house):
        """Test creating an invitation."""
        response = authenticated_client.post(
            "/api/auth/invitations/",
            {"email": "invited@example.com", "house": house.id},
            format="json",
        )
        assert response.status_code == 201
        assert Invitation.objects.filter(email="invited@example.com").exists()


class TestValidateInvitationAPI:
    """Tests for the Validate Invitation API endpoint."""

    def test_validate_valid_invitation(self, api_client, invitation):
        """Test validating a valid invitation."""
        response = api_client.post(
            "/api/auth/validate-invitation/",
            {"token": invitation.token},
            format="json",
        )
        assert response.status_code == 200
        assert response.json()["valid"] is True
        assert response.json()["email"] == invitation.email

    def test_validate_expired_invitation(self, api_client, expired_invitation):
        """Test validating an expired invitation."""
        response = api_client.post(
            "/api/auth/validate-invitation/",
            {"token": expired_invitation.token},
            format="json",
        )
        assert response.status_code == 400

    def test_validate_invalid_token(self, api_client, db):
        """Test validating an invalid token."""
        response = api_client.post(
            "/api/auth/validate-invitation/",
            {"token": "invalid-token"},
            format="json",
        )
        assert response.status_code == 400


class TestRegisterAPI:
    """Tests for the Register API endpoint."""

    def test_register_with_valid_invitation(self, api_client, invitation):
        """Test registering with a valid invitation."""
        response = api_client.post(
            "/api/auth/register/",
            {
                "token": invitation.token,
                "email": invitation.email,
                "password": "newpassword123",
                "password_confirm": "newpassword123",
                "first_name": "New",
                "last_name": "User",
            },
            format="json",
        )
        assert response.status_code == 201
        assert User.objects.filter(email=invitation.email).exists()

    def test_register_with_mismatched_passwords(self, api_client, invitation):
        """Test registering with mismatched passwords."""
        response = api_client.post(
            "/api/auth/register/",
            {
                "token": invitation.token,
                "email": invitation.email,
                "password": "password123",
                "password_confirm": "different123",
                "first_name": "New",
                "last_name": "User",
            },
            format="json",
        )
        assert response.status_code == 400


class TestChangePasswordAPI:
    """Tests for the Change Password API endpoint."""

    def test_change_password(self, authenticated_client, user):
        """Test changing password."""
        response = authenticated_client.post(
            "/api/auth/change-password/",
            {
                "current_password": "testpass123",
                "new_password": "newpassword123",
                "new_password_confirm": "newpassword123",
            },
            format="json",
        )
        assert response.status_code == 200

        # Verify new password works
        user.refresh_from_db()
        assert user.check_password("newpassword123")

    def test_change_password_wrong_current(self, authenticated_client):
        """Test changing password with wrong current password."""
        response = authenticated_client.post(
            "/api/auth/change-password/",
            {
                "current_password": "wrongpassword",
                "new_password": "newpassword123",
                "new_password_confirm": "newpassword123",
            },
            format="json",
        )
        assert response.status_code == 400


class TestForgotPasswordAPI:
    """Tests for the Forgot Password API endpoint."""

    def test_forgot_password(self, api_client, user):
        """Test forgot password request."""
        response = api_client.post(
            "/api/auth/forgot-password/",
            {"email": user.email},
            format="json",
        )
        assert response.status_code == 200
        # Should create a token
        assert PasswordResetToken.objects.filter(user=user).exists()

    def test_forgot_password_nonexistent_email(self, api_client, db):
        """Test forgot password with nonexistent email (should still return 200)."""
        response = api_client.post(
            "/api/auth/forgot-password/",
            {"email": "nonexistent@example.com"},
            format="json",
        )
        # Should return 200 to prevent email enumeration
        assert response.status_code == 200


class TestResetPasswordAPI:
    """Tests for the Reset Password API endpoint."""

    def test_reset_password(self, api_client, user):
        """Test resetting password with valid token."""
        # Create a reset token
        token = PasswordResetToken.objects.create(
            user=user,
            expires_at=timezone.now() + timedelta(hours=1),
        )

        response = api_client.post(
            "/api/auth/reset-password/",
            {
                "token": token.token,
                "new_password": "resetpassword123",
                "new_password_confirm": "resetpassword123",
            },
            format="json",
        )
        assert response.status_code == 200

        # Verify new password works
        user.refresh_from_db()
        assert user.check_password("resetpassword123")

    def test_reset_password_expired_token(self, api_client, user):
        """Test resetting password with expired token."""
        token = PasswordResetToken.objects.create(
            user=user,
            expires_at=timezone.now() - timedelta(hours=1),
        )

        response = api_client.post(
            "/api/auth/reset-password/",
            {
                "token": token.token,
                "new_password": "resetpassword123",
                "new_password_confirm": "resetpassword123",
            },
            format="json",
        )
        assert response.status_code == 400
