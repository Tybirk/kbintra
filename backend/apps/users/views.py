"""
Views for User models.
"""

import contextlib
import json
import os
import shutil
import sqlite3
import tempfile
from typing import Any

from django.conf import settings
from django.contrib import auth
from django.db import connection, models
from django.db.models import Count, QuerySet
from django.http import FileResponse, HttpResponse
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Invitation, User
from .serializers import (
    ChangePasswordSerializer,
    ConfirmEmailChangeSerializer,
    CurrentUserSerializer,
    ForgotPasswordSerializer,
    InvitationCreateSerializer,
    InvitationSerializer,
    InvitationValidateSerializer,
    MentionUserSerializer,
    RequestEmailChangeSerializer,
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
        return CurrentUserSerializer

    def get_object(self) -> User:
        return self.request.user


class UserListView(generics.ListAPIView):
    """
    List all users in the community.
    """

    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = (
        User.objects.filter(is_active=True)
        .select_related("house")
        .annotate(_house_inhabitant_count=Count("house__inhabitants"))
    )


class UserMentionListView(generics.ListAPIView):
    """
    Return active users for @mention autocomplete.
    Optionally filter by ?q= (matches first or last name, case-insensitive).
    No pagination – community has at most ~90 users.
    """

    serializer_class = MentionUserSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None

    def get_queryset(self) -> QuerySet[User]:
        q = self.request.query_params.get("q", "").strip()
        queryset = User.objects.filter(is_active=True)
        if q:
            queryset = queryset.filter(
                models.Q(first_name__icontains=q) | models.Q(last_name__icontains=q)
            )
        return queryset.order_by("first_name", "last_name")


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

    def get_queryset(self) -> QuerySet[User]:
        try:
            days = int(self.request.query_params.get("days", 7))
        except (ValueError, TypeError):
            days = 7
        days = min(days, 30)  # Cap at 30 days

        today = timezone.now().date()
        users_with_birthdays = []

        # Get all active users with birthdates.
        # Annotate inhabitant count so UserSerializer.get_house_inhabitant_count
        # doesn't run a COUNT(*) per user.
        users = (
            User.objects.filter(is_active=True, birthdate__isnull=False)
            .select_related("house")
            .annotate(_house_inhabitant_count=Count("house__inhabitants"))
        )

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


class LogoutView(APIView):
    """
    Destroy the Django session that gates /media/* access.

    JWT-side logout is purely client (the frontend drops the access/refresh
    tokens from localStorage). This endpoint flushes the server-side session so
    the sessionid cookie can no longer be used to fetch media after logout.

    `authentication_classes = []` and AllowAny so a user with an
    expired/malformed JWT can still successfully log out — the session is
    identified by the cookie, not the JWT.
    """

    authentication_classes: list = []
    permission_classes = [permissions.AllowAny]

    def post(self, request: Request) -> Response:
        auth.logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class RequestEmailChangeView(APIView):
    """
    Request an email change. Sends a verification link to the new email address.
    Requires current password confirmation.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request) -> Response:
        serializer = RequestEmailChangeSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        token = serializer.save()

        from django.conf import settings

        from apps.notifications.tasks import send_email_change_verification_task

        confirm_url = f"{settings.SITE_URL}/bekraeft-email?token={token.token}"
        send_email_change_verification_task(
            first_name=request.user.first_name,
            new_email=token.new_email,
            confirm_url=confirm_url,
        )

        return Response({"message": "En bekræftelsesmail er sendt til din nye emailadresse."})


class ConfirmEmailChangeView(APIView):
    """
    Confirm email change using a token from the verification email.
    """

    permission_classes = [permissions.AllowAny]

    def post(self, request: Request) -> Response:
        serializer = ConfirmEmailChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"message": "Din emailadresse er nu opdateret."})


class DeleteAccountView(APIView):
    """
    Delete the authenticated user's account.
    Requires current password for confirmation.
    Cascades to all related data per model definitions.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request) -> Response:
        password = request.data.get("password", "")
        if not request.user.check_password(password):
            return Response(
                {"password": ["Forkert adgangskode."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = request.user

        # Delete profile picture file from disk before deleting the user
        if user.profile_picture:
            with contextlib.suppress(Exception):
                user.profile_picture.delete(save=False)

        user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class DataExportView(APIView):
    """
    Export all personal data for the authenticated user as a JSON file.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> HttpResponse:
        user = request.user

        from apps.forum.models import Post, Thread
        from apps.messaging.models import Message

        threads = list(
            Thread.objects.filter(author=user).values("title", "created_at", "subgroup__name")
        )
        posts = list(
            Post.objects.filter(author=user).values("content", "created_at", "thread__title")
        )
        messages = list(Message.objects.filter(sender=user).values("content", "created_at"))

        # Food registrations (optional – app may not have MealRegistration)
        meal_registrations: list[Any] = []
        try:
            from apps.food.models import MealRegistration

            if user.house_id:
                meal_registrations = list(
                    MealRegistration.objects.filter(house_id=user.house_id).values(
                        "date",
                        "adults_meat",
                        "adults_veg",
                        "children_count",
                        "dining_option",
                        "created_at",
                    )
                )
        except Exception:
            pass

        data = {
            "eksporteret": timezone.now().isoformat(),
            "profil": {
                "fornavn": user.first_name,
                "efternavn": user.last_name,
                "email": user.email,
                "telefonnummer": user.phone_number,
                "fødselsdato": str(user.birthdate) if user.birthdate else None,
                "bio": user.bio,
                "oprettet": user.date_joined.isoformat(),
                "sidst_aktiv": user.last_login.isoformat() if user.last_login else None,
            },
            "forumtraade": threads,
            "forumindlaeg": posts,
            "beskeder_sendt": messages,
            "madregistreringer": meal_registrations,
        }

        response = HttpResponse(
            json.dumps(data, ensure_ascii=False, default=str, indent=2),
            content_type="application/json; charset=utf-8",
        )
        response["Content-Disposition"] = 'attachment; filename="mine-data.json"'
        return response


class IsStaff(permissions.BasePermission):
    def has_permission(self, request: Request, view: Any) -> bool:
        return bool(request.user and request.user.is_staff)


def _delete_orphan_rows(conn: sqlite3.Connection) -> int:
    """Delete rows left pointing at parents that no longer exist.

    The scrub below deletes by hand, table by table, in raw SQL — and a raw
    `sqlite3` connection has `PRAGMA foreign_keys` OFF, so a child table nobody
    remembered to list is orphaned silently rather than raising. That is not a
    cosmetic flaw in the copy: Django's SQLite backend re-checks the *whole*
    database's foreign keys after any table rebuild, so a single orphan makes the
    first schema migration anyone runs on the downloaded file fail with an
    IntegrityError that names a table having nothing to do with their work.

    So this is the backstop for whatever the explicit deletes miss, including
    child models added long after this function was written. It loops because
    removing one orphan can orphan a grandchild in turn.
    """
    total = 0
    while True:
        # Reports (child table, child rowid, parent table, fk index) per bad row,
        # and works regardless of whether foreign key enforcement is on.
        violations = conn.execute("PRAGMA foreign_key_check").fetchall()

        by_table: dict[str, list[int]] = {}
        for table, rowid, _parent, _fkid in violations:
            # WITHOUT ROWID tables report a NULL rowid and cannot be addressed
            # this way. None exist today; skipping them keeps the loop finite.
            if rowid is not None:
                by_table.setdefault(table, []).append(rowid)

        if not by_table:
            return total

        for table, rowids in by_table.items():
            placeholders = ",".join("?" * len(rowids))
            cur = conn.execute(
                f'DELETE FROM "{table}" WHERE rowid IN ({placeholders})',  # noqa: S608
                rowids,
            )
            total += cur.rowcount


def _scrub_private_messages(db_copy_path: str, user_id: int) -> None:
    """Remove private messages from conversations the user is not part of."""
    conn = sqlite3.connect(db_copy_path)
    try:
        # Find conversation IDs the requesting user participates in
        other_convos_sql = """
            SELECT id FROM messaging_conversation
            WHERE id NOT IN (
                SELECT conversation_id FROM messaging_conversation_participants
                WHERE user_id = ?
            )
        """
        cur = conn.execute(other_convos_sql, (user_id,))
        other_ids = [row[0] for row in cur.fetchall()]

        if other_ids:
            placeholders = ",".join("?" * len(other_ids))

            # Delete attachments for messages in those conversations
            conn.execute(
                f"""
                DELETE FROM messaging_messageattachment
                WHERE message_id IN (
                    SELECT id FROM messaging_message WHERE conversation_id IN ({placeholders})
                )
                """,
                other_ids,
            )
            # Delete read statuses
            conn.execute(
                f"""
                DELETE FROM messaging_messagereadstatus
                WHERE message_id IN (
                    SELECT id FROM messaging_message WHERE conversation_id IN ({placeholders})
                )
                """,
                other_ids,
            )
            # Delete reactions
            conn.execute(
                f"""
                DELETE FROM messaging_messagereaction
                WHERE message_id IN (
                    SELECT id FROM messaging_message WHERE conversation_id IN ({placeholders})
                )
                """,
                other_ids,
            )
            # Delete messages
            conn.execute(
                f"DELETE FROM messaging_message WHERE conversation_id IN ({placeholders})",
                other_ids,
            )
            # Delete conversation participants
            conn.execute(
                f"""
                DELETE FROM messaging_conversation_participants
                WHERE conversation_id IN ({placeholders})
                """,
                other_ids,
            )
            # Delete conversations themselves
            conn.execute(
                f"DELETE FROM messaging_conversation WHERE id IN ({placeholders})",
                other_ids,
            )

        # Always sweep, even when nothing was scrubbed: the copy must leave here
        # referentially clean, or migrations fail on it later.
        _delete_orphan_rows(conn)

        conn.commit()
        conn.execute("VACUUM")
    finally:
        conn.close()


def _make_cleanup_close(original_close, tmp_path):
    """Wrap response.close() to delete the temp file after streaming."""

    def close():
        original_close()
        with contextlib.suppress(OSError):
            os.unlink(tmp_path)

    return close


class DownloadDatabaseView(APIView):
    """Download a scrubbed copy of the SQLite database. Staff only.

    Private messages from conversations the requesting user is not part of
    are removed before serving the file.
    """

    permission_classes = [permissions.IsAuthenticated, IsStaff]

    def get(self, request: Request) -> FileResponse:
        db_path = settings.DATABASES["default"]["NAME"]

        # Checkpoint WAL into main db for a consistent snapshot
        try:
            with connection.cursor() as cursor:
                cursor.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        except Exception:
            pass  # In-memory or non-WAL databases don't support this

        # Copy to a temp file so we can scrub without touching the original
        with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as tmp:
            tmp_name = tmp.name
        shutil.copy2(str(db_path), tmp_name)

        _scrub_private_messages(tmp_name, request.user.id)

        f = open(tmp_name, "rb")  # noqa: SIM115
        response = FileResponse(
            f,
            content_type="application/x-sqlite3",
            as_attachment=True,
            filename="db.sqlite3",
        )
        response.close = _make_cleanup_close(response.close, tmp_name)
        return response


class DownloadMediaView(APIView):
    """Download all media files as a zip archive. Staff only."""

    permission_classes = [permissions.IsAuthenticated, IsStaff]

    def get(self, request: Request) -> Response:
        return Response({"detail": "Midlertidigt deaktiveret."}, status=503)
