"""
Tests for the Users app.
"""

from datetime import date, timedelta

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.houses.models import Child
from apps.users.models import EmailChangeToken, Invitation, PasswordResetToken, User
from apps.users.views import _next_birthday


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

    def test_email_is_stored_lowercased(self, db):
        """Test that a capitalised address is normalised on the way in."""
        created = User.objects.create_user(email="Anna@Example.COM", password="pass12345")
        assert created.email == "anna@example.com"
        assert User.objects.get(pk=created.pk).email == "anna@example.com"

    def test_email_whitespace_is_stripped(self, db):
        """Test that a pasted address with stray whitespace is trimmed."""
        created = User.objects.create_user(email="  bo@example.com  ", password="pass12345")
        assert created.email == "bo@example.com"

    def test_email_is_normalised_when_changed_later(self, user):
        """Test that the normalisation also covers updates, not just creation."""
        user.email = "Changed@Example.com"
        user.save(update_fields=["email"])
        user.refresh_from_db()
        assert user.email == "changed@example.com"

    def test_case_variant_email_cannot_be_created(self, user):
        """Test that normalisation makes `unique=True` reject case variants."""
        with pytest.raises(IntegrityError), transaction.atomic():
            User.objects.create_user(email="TEST@Example.com", password="pass12345")


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
        today = timezone.localdate()
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
        today = timezone.localdate()
        user.birthdate = today.replace(year=1990)
        user.save()

        response = authenticated_client.get("/api/users/birthdays/")
        assert response.status_code == 200

        data = response.json()
        assert len(data) == 1
        assert data[0]["id"] == user.id

    def test_birthdays_past_this_year(self, authenticated_client, user):
        """Test birthdays endpoint excludes birthdays that passed this year."""
        today = timezone.localdate()
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
        today = timezone.localdate()
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
        today = timezone.localdate()

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

    def test_birthdays_include_children(self, authenticated_client, house):
        """Children are listed too, marked as such and pointing at their house."""
        today = timezone.localdate()
        child = Child.objects.create(
            house=house, name="Lille Bo", birthdate=(today + timedelta(days=4)).replace(year=2019)
        )

        response = authenticated_client.get("/api/users/birthdays/")
        assert response.status_code == 200

        data = response.json()
        assert len(data) == 1
        assert data[0]["kind"] == "child"
        assert data[0]["id"] == child.id
        assert data[0]["name"] == "Lille Bo"
        assert data[0]["house_slug"] == house.slug

    def test_birthdays_mix_users_and_children_by_date(self, authenticated_client, user, house):
        """One list, soonest first, whoever the birthday belongs to."""
        today = timezone.localdate()
        user.birthdate = (today + timedelta(days=6)).replace(year=1990)
        user.save()
        Child.objects.create(
            house=house, name="Lille Bo", birthdate=(today + timedelta(days=1)).replace(year=2019)
        )

        data = authenticated_client.get("/api/users/birthdays/").json()
        assert [(e["kind"], e["days_until"]) for e in data] == [("child", 1), ("user", 6)]

    def test_birthdays_report_the_age_being_turned(self, authenticated_client, user):
        """``turning`` is the age on the day, not the age today."""
        today = timezone.localdate()
        upcoming = today + timedelta(days=3)
        user.birthdate = upcoming.replace(year=upcoming.year - 40)
        user.save()

        data = authenticated_client.get("/api/users/birthdays/").json()
        assert data[0]["kind"] == "user"
        assert data[0]["days_until"] == 3
        assert data[0]["turning"] == 40

    def test_birthdays_skip_inactive_users(self, authenticated_client, second_user):
        """Someone who has moved out does not get a birthday on the dashboard."""
        second_user.birthdate = timezone.localdate().replace(year=1985)
        second_user.is_active = False
        second_user.save()

        assert authenticated_client.get("/api/users/birthdays/").json() == []


class TestNextBirthday:
    """The date arithmetic behind the birthdays list."""

    def test_a_birthday_today_is_today(self):
        assert _next_birthday(date(1990, 9, 25), date(2026, 9, 25)) == date(2026, 9, 25)

    def test_a_birthday_already_passed_moves_to_next_year(self):
        assert _next_birthday(date(1990, 1, 3), date(2026, 9, 25)) == date(2027, 1, 3)

    def test_a_leap_day_birthday_falls_on_the_28th_in_other_years(self):
        assert _next_birthday(date(2000, 2, 29), date(2026, 2, 1)) == date(2026, 2, 28)

    def test_a_leap_day_birthday_is_kept_in_a_leap_year(self):
        assert _next_birthday(date(2000, 2, 29), date(2028, 2, 1)) == date(2028, 2, 29)


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

    def test_can_save_and_read_own_bank_details(self, authenticated_client, user):
        """Bank reg/konto round-trips through /users/me/ for the owner."""
        response = authenticated_client.patch(
            "/api/users/me/",
            {"bank_reg_nr": "1234", "bank_account_number": "9876543210"},
            format="json",
        )
        assert response.status_code == 200, response.json()
        user.refresh_from_db()
        assert user.bank_reg_nr == "1234"
        assert user.bank_account_number == "9876543210"

        me = authenticated_client.get("/api/users/me/").json()
        assert me["bank_reg_nr"] == "1234"
        assert me["bank_account_number"] == "9876543210"

    def test_bank_details_rejects_bad_format(self, authenticated_client, user):
        response = authenticated_client.patch(
            "/api/users/me/",
            {"bank_reg_nr": "12"},
            format="json",
        )
        assert response.status_code == 400
        assert "bank_reg_nr" in response.json()

    def test_bank_details_not_exposed_in_user_list_or_detail(
        self, authenticated_client, user, second_user
    ):
        """Bank details are private — never visible to other residents."""
        second_user.bank_reg_nr = "4321"
        second_user.bank_account_number = "1122334455"
        second_user.save(update_fields=["bank_reg_nr", "bank_account_number"])

        list_resp = authenticated_client.get("/api/users/").json()
        rows = list_resp.get("results", list_resp) if isinstance(list_resp, dict) else list_resp
        for row in rows:
            assert "bank_reg_nr" not in row
            assert "bank_account_number" not in row

        detail = authenticated_client.get(f"/api/users/{second_user.id}/").json()
        assert "bank_reg_nr" not in detail
        assert "bank_account_number" not in detail


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


class TestLoginAPI:
    """Tests for the token (login) API endpoint."""

    def test_login_with_exact_email(self, api_client, user):
        """Test logging in with the address exactly as stored."""
        response = api_client.post(
            "/api/auth/token/",
            {"email": user.email, "password": "testpass123"},
            format="json",
        )
        assert response.status_code == 200
        assert "access" in response.json()

    def test_login_with_capitalised_email(self, api_client, user):
        """Test that a capitalised address still logs in (phone keyboards)."""
        response = api_client.post(
            "/api/auth/token/",
            {"email": "Test@Example.com", "password": "testpass123"},
            format="json",
        )
        assert response.status_code == 200
        assert "access" in response.json()

    def test_login_with_surrounding_whitespace(self, api_client, user):
        """Test that a pasted address with stray whitespace still logs in."""
        response = api_client.post(
            "/api/auth/token/",
            {"email": "  test@example.com  ", "password": "testpass123"},
            format="json",
        )
        assert response.status_code == 200

    def test_login_with_wrong_password_still_fails(self, api_client, user):
        """Test that case-insensitivity does not weaken the password check."""
        response = api_client.post(
            "/api/auth/token/",
            {"email": "TEST@EXAMPLE.COM", "password": "wrongpass"},
            format="json",
        )
        assert response.status_code == 401

    def test_login_with_unknown_email_fails(self, api_client, db):
        """Test that an unregistered address is rejected."""
        response = api_client.post(
            "/api/auth/token/",
            {"email": "nobody@example.com", "password": "testpass123"},
            format="json",
        )
        assert response.status_code == 401

    def test_inactive_user_cannot_log_in(self, api_client, user):
        """Test that a deactivated member is still refused."""
        user.is_active = False
        user.save(update_fields=["is_active"])
        response = api_client.post(
            "/api/auth/token/",
            {"email": "Test@example.com", "password": "testpass123"},
            format="json",
        )
        assert response.status_code == 401


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
        # avatar_url should return the original URL (signed with a short-lived
        # token, so compare the base path before the ?exp=&sig= query).
        assert u.avatar_url.startswith(u.profile_picture.url)
        assert "sig=" in u.avatar_url

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
        # avatar_url prefers the thumbnail (signed with a short-lived token, so
        # compare the base path before the ?exp=&sig= query).
        assert u.avatar_url.startswith(u.profile_picture_thumbnail.url)
        assert not u.avatar_url.startswith(u.profile_picture.url)


@pytest.mark.django_db
class TestMentionAutocomplete:
    """@mention lookup goes through the search index, like the other name searches.

    It had no coverage at all before, which is how the Danish-letter bug lived
    here as long as it did.
    """

    def _people(self):
        from apps.users.models import User

        return (
            User.objects.create_user(
                email="oejvind@test.com", password="x", first_name="Øjvind", last_name="Ørsted"
            ),
            User.objects.create_user(
                email="hansen@test.com", password="x", first_name="Hanne", last_name="Hansen"
            ),
        )

    def test_finds_a_name_typed_in_either_case(self, authenticated_client):
        self._people()

        for query in ("øjvind", "Øjvind", "ØJVIND", "oejvind"):
            names = [
                person["first_name"]
                for person in authenticated_client.get(f"/api/users/mentions/?q={query}").data
            ]
            assert names == ["Øjvind"], query

    def test_matches_either_part_of_the_name(self, authenticated_client):
        self._people()

        assert len(authenticated_client.get("/api/users/mentions/?q=ørsted").data) == 1
        assert len(authenticated_client.get("/api/users/mentions/?q=hanne").data) == 1

    def test_matches_from_the_start_of_a_name_not_the_middle(self, authenticated_client):
        """Prefix, not substring — "ans" no longer offers "Hansen"."""
        self._people()

        assert len(authenticated_client.get("/api/users/mentions/?q=Han").data) == 1
        assert len(authenticated_client.get("/api/users/mentions/?q=ans").data) == 0

    def test_no_query_returns_everyone_active(self, authenticated_client):
        self._people()

        # The two above plus the fixture's own user.
        assert len(authenticated_client.get("/api/users/mentions/").data) == 3


@pytest.mark.django_db
class TestBirthdayNotifications:
    """The 08:00 task tells every other active resident about today's birthdays."""

    TODAY = date(2026, 9, 25)

    def _run(self):
        from unittest.mock import patch

        from apps.users.tasks import send_birthday_notifications

        with patch("django.utils.timezone.localdate", return_value=self.TODAY):
            send_birthday_notifications.call_local()

    def _residents(self, house):
        birthday = User.objects.create_user(
            email="bday@example.com",
            password="pass",
            first_name="Anna",
            last_name="Hansen",
            house=house,
            birthdate=date(1990, 9, 25),
        )
        other = User.objects.create_user(
            email="other@example.com", password="pass", first_name="Bo", house=house
        )
        return birthday, other

    def test_others_are_told_and_the_birthday_person_is_not(self, house):
        from apps.notifications.models import Notification, NotificationType

        birthday, other = self._residents(house)
        User.objects.create_user(
            email="gone@example.com", password="pass", first_name="Gone", is_active=False
        )

        self._run()

        rows = Notification.objects.filter(notification_type=NotificationType.BIRTHDAY)
        assert list(rows.values_list("user__email", flat=True)) == ["other@example.com"]
        row = rows.get()
        assert row.title == "Anna Hansen har fødselsdag i dag"
        assert "fylder 36 år" in row.message
        assert row.link == f"/profil/{birthday.pk}"

    def test_children_are_included_and_link_to_their_house(self, house):
        from apps.houses.models import Child
        from apps.notifications.models import Notification

        _, other = self._residents(house)
        Child.objects.create(house=house, name="Emma", birthdate=date(2020, 9, 25))

        self._run()

        row = Notification.objects.get(user=other, title__startswith="Emma")
        assert row.title == f"Emma ({house.name}) har fødselsdag i dag"
        assert "fylder 6 år" in row.message
        assert row.link == f"/beboere/hus/{house.slug}"

    def test_no_notification_on_other_days(self, house):
        from apps.notifications.models import Notification

        birthday, _ = self._residents(house)
        birthday.birthdate = date(1990, 9, 26)
        birthday.save()

        self._run()

        assert not Notification.objects.exists()

    def test_opting_out_stops_it(self, house):
        from apps.notifications.models import Notification, NotificationPreference

        _, other = self._residents(house)
        NotificationPreference.objects.update_or_create(
            user=other, defaults={"notify_birthdays": False}
        )

        self._run()

        assert not Notification.objects.filter(user=other).exists()

    def test_only_in_app_is_on_by_default(self, user):
        from apps.notifications.models import NotificationPreference

        prefs = NotificationPreference(user=user)
        assert prefs.notify_birthdays is True
        assert prefs.push_birthdays is False
        assert prefs.email_birthdays is False
