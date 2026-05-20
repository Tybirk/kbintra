"""
Tests for the Users app.
"""

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.users.models import EmailChangeToken, Invitation, PasswordResetToken, User


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
        # Handle both paginated (dict with results) and non-paginated (list) responses
        results = data.get("results", data) if isinstance(data, dict) else data
        assert len(results) >= 2

    def test_get_user_detail(self, authenticated_client, second_user):
        """Test getting user details."""
        response = authenticated_client.get(f"/api/users/{second_user.id}/")
        assert response.status_code == 200
        assert response.json()["email"] == second_user.email


class TestUpcomingBirthdaysAPI:
    """Tests for the Upcoming Birthdays API endpoint."""

    def test_birthdays_unauthenticated(self, api_client):
        """Test that unauthenticated users cannot access birthdays."""
        response = api_client.get("/api/users/birthdays/")
        assert response.status_code == 401

    def test_birthdays_no_birthdays(self, authenticated_client):
        """Test birthdays endpoint when no users have birthdays set."""
        response = authenticated_client.get("/api/users/birthdays/")
        assert response.status_code == 200
        assert response.json() == []

    def test_birthdays_upcoming(self, authenticated_client, user):
        """Test birthdays endpoint returns users with upcoming birthdays."""
        # Set user's birthday to 3 days from now (same month/day in the year)
        today = timezone.now().date()
        birthday = today.replace(year=1990) + timedelta(days=3)
        user.birthdate = birthday
        user.save()

        response = authenticated_client.get("/api/users/birthdays/")
        assert response.status_code == 200

        data = response.json()
        assert len(data) == 1
        assert data[0]["id"] == user.id

    def test_birthdays_today(self, authenticated_client, user):
        """Test birthdays endpoint includes today's birthdays."""
        today = timezone.now().date()
        user.birthdate = today.replace(year=1990)
        user.save()

        response = authenticated_client.get("/api/users/birthdays/")
        assert response.status_code == 200

        data = response.json()
        assert len(data) == 1
        assert data[0]["id"] == user.id

    def test_birthdays_past_this_year(self, authenticated_client, user):
        """Test birthdays endpoint excludes birthdays that passed this year."""
        today = timezone.now().date()
        # Set birthday to 10 days ago (should not appear in 7-day window)
        birthday = today.replace(year=1990) - timedelta(days=10)
        user.birthdate = birthday
        user.save()

        response = authenticated_client.get("/api/users/birthdays/")
        assert response.status_code == 200

        data = response.json()
        assert len(data) == 0

    def test_birthdays_custom_days(self, authenticated_client, user):
        """Test birthdays endpoint with custom days parameter."""
        today = timezone.now().date()
        # Set birthday to 15 days from now
        birthday = today.replace(year=1990) + timedelta(days=15)
        user.birthdate = birthday
        user.save()

        # Default 7 days should not include this
        response = authenticated_client.get("/api/users/birthdays/")
        assert response.status_code == 200
        assert len(response.json()) == 0

        # 20 days should include this
        response = authenticated_client.get("/api/users/birthdays/?days=20")
        assert response.status_code == 200
        assert len(response.json()) == 1

    def test_birthdays_sorted_by_date(self, authenticated_client, user, second_user):
        """Test birthdays are sorted by proximity."""
        today = timezone.now().date()

        # User has birthday in 5 days
        user.birthdate = (today + timedelta(days=5)).replace(year=1990)
        user.save()

        # Second user has birthday in 2 days
        second_user.birthdate = (today + timedelta(days=2)).replace(year=1985)
        second_user.save()

        response = authenticated_client.get("/api/users/birthdays/")
        assert response.status_code == 200

        data = response.json()
        assert len(data) == 2
        # Second user should come first (closer birthday)
        assert data[0]["id"] == second_user.id
        assert data[1]["id"] == user.id


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


class TestRequestEmailChangeAPI:
    """Tests for the Request Email Change API endpoint."""

    def test_request_email_change(self, authenticated_client, user):
        """Test requesting an email change with valid data."""
        response = authenticated_client.post(
            "/api/auth/request-email-change/",
            {"new_email": "newemail@example.com", "current_password": "testpass123"},
            format="json",
        )
        assert response.status_code == 200
        assert EmailChangeToken.objects.filter(user=user, new_email="newemail@example.com").exists()

    def test_request_email_change_wrong_password(self, authenticated_client):
        """Test that wrong current password is rejected."""
        response = authenticated_client.post(
            "/api/auth/request-email-change/",
            {"new_email": "newemail@example.com", "current_password": "wrongpassword"},
            format="json",
        )
        assert response.status_code == 400

    def test_request_email_change_same_email(self, authenticated_client, user):
        """Test that changing to the same email is rejected."""
        response = authenticated_client.post(
            "/api/auth/request-email-change/",
            {"new_email": user.email, "current_password": "testpass123"},
            format="json",
        )
        assert response.status_code == 400

    def test_request_email_change_already_taken(self, authenticated_client, db, house):
        """Test that changing to an already registered email is rejected."""
        other = User.objects.create_user(
            email="taken@example.com",
            password="pass",
            first_name="Other",
            last_name="User",
            house=house,
        )
        response = authenticated_client.post(
            "/api/auth/request-email-change/",
            {"new_email": other.email, "current_password": "testpass123"},
            format="json",
        )
        assert response.status_code == 400

    def test_request_email_change_unauthenticated(self, api_client):
        """Test that unauthenticated requests are rejected."""
        response = api_client.post(
            "/api/auth/request-email-change/",
            {"new_email": "newemail@example.com", "current_password": "testpass123"},
            format="json",
        )
        assert response.status_code == 401

    def test_request_email_change_invalidates_old_tokens(self, authenticated_client, user):
        """Test that requesting a new change invalidates previous pending tokens."""
        old_token = EmailChangeToken.objects.create(
            user=user,
            new_email="old@example.com",
            expires_at=timezone.now() + timedelta(hours=1),
        )
        authenticated_client.post(
            "/api/auth/request-email-change/",
            {"new_email": "newemail@example.com", "current_password": "testpass123"},
            format="json",
        )
        old_token.refresh_from_db()
        assert old_token.used_at is not None


class TestConfirmEmailChangeAPI:
    """Tests for the Confirm Email Change API endpoint."""

    def test_confirm_email_change(self, api_client, user):
        """Test confirming email change with a valid token."""
        token = EmailChangeToken.objects.create(
            user=user,
            new_email="confirmed@example.com",
            expires_at=timezone.now() + timedelta(hours=1),
        )
        response = api_client.post(
            "/api/auth/confirm-email-change/",
            {"token": token.token},
            format="json",
        )
        assert response.status_code == 200
        user.refresh_from_db()
        assert user.email == "confirmed@example.com"
        token.refresh_from_db()
        assert token.used_at is not None

    def test_confirm_email_change_expired_token(self, api_client, user):
        """Test that expired tokens are rejected."""
        token = EmailChangeToken.objects.create(
            user=user,
            new_email="confirmed@example.com",
            expires_at=timezone.now() - timedelta(hours=1),
        )
        response = api_client.post(
            "/api/auth/confirm-email-change/",
            {"token": token.token},
            format="json",
        )
        assert response.status_code == 400
        user.refresh_from_db()
        assert user.email != "confirmed@example.com"

    def test_confirm_email_change_invalid_token(self, api_client, db):
        """Test that invalid tokens are rejected."""
        response = api_client.post(
            "/api/auth/confirm-email-change/",
            {"token": "notavalidtoken"},
            format="json",
        )
        assert response.status_code == 400

    def test_confirm_email_change_already_used(self, api_client, user):
        """Test that already-used tokens are rejected."""
        token = EmailChangeToken.objects.create(
            user=user,
            new_email="confirmed@example.com",
            expires_at=timezone.now() + timedelta(hours=1),
            used_at=timezone.now(),
        )
        response = api_client.post(
            "/api/auth/confirm-email-change/",
            {"token": token.token},
            format="json",
        )
        assert response.status_code == 400


class TestAdminDownloadAPI:
    """Tests for admin download endpoints (staff-only)."""

    def test_download_db_requires_auth(self, api_client, db):
        """Test that unauthenticated requests are rejected."""
        response = api_client.get("/api/auth/admin/download-db/")
        assert response.status_code == 401

    def test_download_db_requires_staff(self, authenticated_client):
        """Test that non-staff users are rejected."""
        response = authenticated_client.get("/api/auth/admin/download-db/")
        assert response.status_code == 403

    def test_download_db_staff_ok(self, admin_client, settings, tmp_path):
        """Test that staff users can download the database."""
        # Create a real SQLite database so _scrub_private_messages can query it
        import sqlite3

        db_file = tmp_path / "db.sqlite3"
        conn = sqlite3.connect(str(db_file))
        conn.execute("CREATE TABLE messaging_conversation (id INTEGER PRIMARY KEY)")
        conn.execute(
            "CREATE TABLE messaging_conversation_participants"
            " (id INTEGER PRIMARY KEY, conversation_id INTEGER, user_id INTEGER)"
        )
        conn.close()
        settings.DATABASES = {"default": {**settings.DATABASES["default"], "NAME": str(db_file)}}
        response = admin_client.get("/api/auth/admin/download-db/")
        assert response.status_code == 200
        assert response["Content-Type"] == "application/x-sqlite3"

    def test_download_media_requires_auth(self, api_client, db):
        """Test that unauthenticated requests are rejected."""
        response = api_client.get("/api/auth/admin/download-media/")
        assert response.status_code == 401

    def test_download_media_requires_staff(self, authenticated_client):
        """Test that non-staff users are rejected."""
        response = authenticated_client.get("/api/auth/admin/download-media/")
        assert response.status_code == 403

    def test_download_media_staff_disabled(self, admin_client):
        """The media download endpoint is currently disabled — staff still hits
        permission checks (i.e. it's not a 401/403), but gets 503."""
        response = admin_client.get("/api/auth/admin/download-media/")
        assert response.status_code == 503


class TestUserProfileThumbnail:
    """Tests for the small thumbnail variant on User.profile_picture."""

    def _real_jpeg_bytes(self, width: int = 800, height: int = 600) -> bytes:
        from io import BytesIO

        from PIL import Image

        img = Image.new("RGB", (width, height), color=(40, 80, 120))
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=80)
        return buf.getvalue()

    def test_thumbnail_generated_on_save(self, db):
        from apps.users.models import User

        u = User.objects.create_user(email="thumb@test.com", password="x")
        u.profile_picture.save(
            "p.jpg",
            __import__(
                "django.core.files.uploadedfile",
                fromlist=["SimpleUploadedFile"],
            ).SimpleUploadedFile("p.jpg", self._real_jpeg_bytes(2000, 1500)),
            save=True,
        )
        u.refresh_from_db()
        assert u.profile_picture_thumbnail

        from PIL import Image as PILImage

        with u.profile_picture_thumbnail.open("rb") as fh, PILImage.open(fh) as img:
            assert img.size == (400, 400)
            assert img.format == "JPEG"

    def test_avatar_url_falls_back_to_original(self, db):
        from django.core.files.uploadedfile import SimpleUploadedFile

        from apps.users.models import User

        u = User.objects.create_user(email="fallback@test.com", password="x")
        # Drop a tiny file that Pillow can still open but bypass the auto
        # generation by writing directly to the field without triggering
        # signals — simulate the "task hasn't run yet" state.
        u.profile_picture = SimpleUploadedFile("p.jpg", b"\xff\xd8\xff\xd9")  # truncated jpeg
        User.objects.filter(pk=u.pk).update(profile_picture="profile_pictures/x.jpg")
        u.refresh_from_db()
        assert not u.profile_picture_thumbnail
        # avatar_url should return the original URL
        assert u.avatar_url == u.profile_picture.url

    def test_avatar_url_prefers_thumbnail(self, db):
        from django.core.files.uploadedfile import SimpleUploadedFile

        from apps.users.models import User

        u = User.objects.create_user(email="prefer@test.com", password="x")
        u.profile_picture.save(
            "p.jpg",
            SimpleUploadedFile("p.jpg", self._real_jpeg_bytes()),
            save=True,
        )
        u.refresh_from_db()
        assert u.profile_picture_thumbnail
        assert u.avatar_url == u.profile_picture_thumbnail.url
        assert u.avatar_url != u.profile_picture.url
