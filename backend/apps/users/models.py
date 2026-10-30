"""
User models for KB Intra community platform.
"""

from __future__ import annotations

import secrets
from datetime import date as date_type
from datetime import timedelta
from typing import TYPE_CHECKING

from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models
from django.utils import timezone

if TYPE_CHECKING:
    from apps.expenses.models import Expense


class UserManager(BaseUserManager["User"]):
    """Custom user manager that uses email as the unique identifier."""

    def create_user(
        self,
        email: str,
        password: str | None = None,
        **extra_fields: object,
    ) -> User:
        """Create and return a regular user with the given email and password."""
        if not email:
            raise ValueError("The Email field must be set")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(
        self,
        email: str,
        password: str | None = None,
        **extra_fields: object,
    ) -> User:
        """Create and return a superuser with the given email and password."""
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)

        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True.")

        return self.create_user(email, password, **extra_fields)

    def members(self) -> models.QuerySet:
        """Everyone who belongs to the community right now: active accounts,
        minus residents who have moved out and only keep their login for a
        while (see ``User.moved_out_on``).

        Use this for "everybody" — the directory, @mentions, birthdays, search.
        It still includes admin and test accounts without a house; for the
        people who actually live here, see ``apps.food.utils.residents()``.
        """
        return self.filter(is_active=True, moved_out_on__isnull=True)


class User(AbstractUser):
    """
    Custom User model for KB Intra.
    Uses email as the unique identifier instead of username.
    """

    username = None
    email = models.EmailField("email address", unique=True)

    # Profile fields
    phone_number = models.CharField(max_length=20, blank=True)
    birthdate = models.DateField(null=True, blank=True)
    hide_birth_year = models.BooleanField(
        default=False,
        help_text="Show others only the day and month of the birthday, never the year or age",
    )
    profile_picture = models.ImageField(
        upload_to="profile_pictures/",
        null=True,
        blank=True,
    )
    profile_picture_thumbnail = models.ImageField(
        upload_to="profile_pictures/thumbs/",
        null=True,
        blank=True,
        help_text="400x400 JPEG square crop, generated server-side on upload.",
    )
    bio = models.TextField(blank=True, max_length=1000)

    # Bank details for reimbursing expenses (udlæg). Optional; used to prefill
    # the expense form. Private — only ever exposed to the user themselves
    # (see CurrentUserSerializer), never in the shared user list/detail.
    bank_reg_nr = models.CharField(
        max_length=10,
        blank=True,
        help_text="Bank reg. nr. (4 cifre) til udbetaling af udlæg",
    )
    bank_account_number = models.CharField(
        max_length=20,
        blank=True,
        help_text="Kontonummer til udbetaling af udlæg",
    )

    @property
    def avatar_url(self) -> str | None:
        """Best URL for displaying this user's avatar. Falls back to the
        original if the thumbnail hasn't been generated yet. Signed so <img>
        tags authenticate without the session cookie (see apps.backup.signing)."""
        from apps.backup.signing import signed_media_url

        if self.profile_picture_thumbnail:
            return signed_media_url(self.profile_picture_thumbnail.url)
        if self.profile_picture:
            return signed_media_url(self.profile_picture.url)
        return None

    # House relationship (nullable - user might not be assigned to a house yet)
    house = models.ForeignKey(
        "houses.House",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="inhabitants",
    )

    # Set when a handover (houses.Handover) moves this resident out. From then on
    # they have no house, so everything that goes by the house (madhold, meal
    # registration, the house page, bildeling) lets go of them by itself, and
    # User.objects.members() leaves them out of the rest. They can still log in
    # until the handover's access_until, when the account is deactivated.
    moved_out_on = models.DateField(null=True, blank=True)

    is_child = models.BooleanField(
        default=False,
        help_text=(
            "A child of the household who has an account. Age doesn't decide it: a "
            "grown-up child living at home is still one. Children are never madhold cooks."
        ),
    )

    # Food team related fields
    is_exempt_from_food_teams = models.BooleanField(
        default=False,
        help_text="User is exempt from food team duty (e.g., buyers, special circumstances)",
    )
    is_over_50 = models.BooleanField(
        default=False,
        help_text=(
            "Fallback for residents without a birthdate — read via "
            "is_over_50_effective, never directly (max 2 per team for balance)"
        ),
    )
    can_be_head_chef = models.BooleanField(
        default=False,
        help_text="User can be head chef (at least 1 required per team)",
    )
    prefers_cooking_with_housemate = models.BooleanField(
        default=False,
        help_text="User prefers to be on the same team as their housemate",
    )
    default_cooking_days = models.JSONField(
        default=list,
        blank=True,
        help_text="Default days of the week user is available to cook (0=Mon, 1=Tue, 2=Wed, 3=Thu)",
    )
    food_team_pause_reason = models.TextField(
        blank=True,
        help_text=(
            "Why this user is stepping back from food teams, shown to food admins "
            "next to is_exempt_from_food_teams. Free text: 'away until spring', "
            "'health', or nothing at all."
        ),
    )
    food_team_pause_until = models.DateField(
        null=True,
        blank=True,
        help_text=(
            "The pause (is_exempt_from_food_teams) lifts itself on this day. New "
            "residents start with one for their first month. Cleared whenever the "
            "pause ends some other way or gets a new reason, so it can never end "
            "a later pause."
        ),
    )
    is_food_admin = models.BooleanField(
        default=False,
        help_text="User has food admin privileges (cost reports, refresh menus, etc.)",
    )
    is_economy_admin = models.BooleanField(
        default=False,
        help_text=(
            "User has economy admin privileges (manage udlæg/expense reimbursements "
            "and view the food cost report)."
        ),
    )
    is_food_economy_admin = models.BooleanField(
        default=False,
        help_text=(
            "Madøkonomiansvarlig: gets the notice for udlæg to fællesmad and may mark "
            "those (only those) paid or rejected."
        ),
    )

    @property
    def public_birthdate(self) -> str | None:
        """The birthdate as other residents may see it.

        ISO "1990-09-25" normally, but "--09-25" (ISO 8601's date without a
        year) for someone who has chosen to hide their year. It is dropped here
        rather than in the browser, because anything the API sends can be read.
        """
        if not self.birthdate:
            return None
        if self.hide_birth_year:
            return self.birthdate.strftime("--%m-%d")
        return self.birthdate.isoformat()

    @property
    def age(self) -> int | None:
        """Age in whole years, or None when we have no birthdate on file."""
        if not self.birthdate:
            return None
        today = date_type.today()
        return (
            today.year
            - self.birthdate.year
            - ((today.month, today.day) < (self.birthdate.month, self.birthdate.day))
        )

    @property
    def is_over_50_effective(self) -> bool:
        """Whether the food-team generator should count this person as over 50.

        Deduced from the birthdate whenever we have one, so nobody has to keep a
        second copy of their own age up to date (and nobody quietly ages out of
        the balancing rule). ``is_over_50`` is only the fallback for residents
        who have not filled in a birthdate, and is the only case where the
        profile page still asks.
        """
        age = self.age
        return age >= 50 if age is not None else self.is_over_50

    @property
    def has_food_admin(self) -> bool:
        """Regular admins (is_staff) implicitly have food admin privileges."""
        return self.is_staff or self.is_food_admin

    @property
    def has_economy_admin(self) -> bool:
        """Regular admins (is_staff) implicitly have economy admin privileges."""
        return self.is_staff or self.is_economy_admin

    def can_process_expense(self, expense: Expense) -> bool:
        """Whether this user may mark *expense* paid/rejected.

        The treasurer (economy admin, or staff) settles every udlæg; the
        madøkonomiansvarlig settles only the ones flagged ``food_related``.
        """
        if self.has_economy_admin:
            return True
        return bool(self.is_food_economy_admin and expense.food_related)

    # Accessibility preference
    accessibility_mode = models.BooleanField(
        default=False,
        help_text="User prefers larger text and higher contrast (for visually impaired)",
    )

    # Forum thread display preference
    hide_closed_threads = models.BooleanField(
        default=False,
        help_text="Hide closed threads from subgroup thread lists",
    )

    # Which version of the bildeling loan terms this resident accepted as a
    # borrower. The owner's side of the same agreement lives on houses.Car; this
    # is the borrower's, and it is asked for once rather than at every request.
    # Stored as the version, not a boolean, so new terms ask again instead of
    # silently carrying an agreement to text nobody saw.
    carsharing_terms_accepted_version = models.CharField(
        max_length=20,
        blank=True,
        default="",
        help_text="Version of the car sharing loan terms accepted as a borrower",
    )
    carsharing_terms_accepted_at = models.DateTimeField(null=True, blank=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    objects: UserManager = UserManager()

    class Meta:
        ordering = ["first_name", "last_name"]

    def __str__(self) -> str:
        return self.get_full_name() or self.email

    def save(self, *args: object, **kwargs: object) -> None:
        """Store the email address in canonical (stripped, lowercased) form.

        Email addresses are case-insensitive in practice, and phone keyboards
        routinely capitalise the first letter of one. Normalising here rather
        than in each serializer covers the admin and the management commands
        too, and it makes the `unique=True` on the column mean what it looks
        like it means: SQLite compares text with a binary collation, so without
        this it would happily store both `anna@example.com` and
        `Anna@example.com` as separate members.
        """
        if self.email:
            self.email = self.email.strip().lower()
        # A pause end date only belongs to the pause it was set with. Lifted by
        # hand, by a wish or by the admin, the date goes too, or it would end the
        # next pause this person sets themselves. Given a new reason, it is a new
        # pause, and the old end date would cut it short.
        if self.food_team_pause_until and (
            not self.is_exempt_from_food_teams or self._pause_reason_changed(kwargs)
        ):
            self._clear_on_save(kwargs, "food_team_pause_until")
        # Moved out means without a house. Someone an admin puts back in a house
        # (they moved within the community after all) lives here again.
        if self.house_id and self.moved_out_on:
            self._clear_on_save(kwargs, "moved_out_on")
        super().save(*args, **kwargs)

    def _pause_reason_changed(self, save_kwargs: dict) -> bool:
        """Whether this save writes a new pause reason and leaves the end date as
        it was. A save that sets the end date too (a wish giving a pause back)
        keeps it. Only paused people with an end date get here, so the extra
        query is rare."""
        update_fields = save_kwargs.get("update_fields")
        if self.pk is None or (
            update_fields is not None and "food_team_pause_reason" not in update_fields
        ):
            return False
        stored = (
            type(self)
            .objects.filter(pk=self.pk)
            .values("food_team_pause_reason", "food_team_pause_until")
            .first()
        )
        return bool(
            stored
            and stored["food_team_pause_until"] == self.food_team_pause_until
            and stored["food_team_pause_reason"] != self.food_team_pause_reason
        )

    def _clear_on_save(self, save_kwargs: dict, field_name: str) -> None:
        """Clear a field as part of this save, adding it to an explicit
        update_fields so it is written too."""
        setattr(self, field_name, None)
        update_fields = save_kwargs.get("update_fields")
        if update_fields is not None and field_name not in update_fields:
            save_kwargs["update_fields"] = [*update_fields, field_name]

    def get_full_name(self) -> str:
        """Return the first_name plus the last_name, with a space in between."""
        full_name = f"{self.first_name} {self.last_name}".strip()
        return full_name


class Invitation(models.Model):
    """
    Invitation model for invite-only registration.
    Users can only register if they have a valid invitation token.
    """

    email = models.EmailField()
    token = models.CharField(max_length=64, unique=True, editable=False)
    house = models.ForeignKey(
        "houses.House",
        on_delete=models.CASCADE,
        related_name="invitations",
        help_text="The house the invited user will belong to",
    )
    # Who is coming, as the admin typed it in: prefills the registration form,
    # and the phone number is copied onto the new user.
    first_name = models.CharField(max_length=150, blank=True)
    last_name = models.CharField(max_length=150, blank=True)
    phone_number = models.CharField(max_length=20, blank=True)
    handover = models.ForeignKey(
        "houses.Handover",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="invitations",
    )
    # A handover invitation is mailed on send_on (houses.handover). Invitations
    # without one predate that and were never mailed by the app.
    send_on = models.DateField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name="sent_invitations",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    used_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField()

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        status = "used" if self.used_at else "pending"
        return f"Invitation for {self.email} ({status})"

    def save(self, *args: object, **kwargs: object) -> None:
        """Generate token and set expiry on first save."""
        if not self.token:
            self.token = secrets.token_urlsafe(48)
        if not self.expires_at:
            self.expires_at = timezone.now() + timedelta(days=7)
        super().save(*args, **kwargs)

    @property
    def is_valid(self) -> bool:
        """Check if invitation is still valid (not used and not expired)."""
        if self.used_at:
            return False
        return timezone.now() < self.expires_at

    def mark_used(self) -> None:
        """Mark the invitation as used."""
        self.used_at = timezone.now()
        self.save(update_fields=["used_at"])


class PasswordResetToken(models.Model):
    """
    Token for password reset requests.
    Tokens are single-use and expire after 1 hour.
    """

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="password_reset_tokens",
    )
    token = models.CharField(max_length=64, unique=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        status = "used" if self.used_at else ("expired" if not self.is_valid else "active")
        return f"Password reset for {self.user.email} ({status})"

    def save(self, *args: object, **kwargs: object) -> None:
        """Generate token and set expiry on first save."""
        if not self.token:
            self.token = secrets.token_urlsafe(48)
        if not self.expires_at:
            self.expires_at = timezone.now() + timedelta(hours=1)
        super().save(*args, **kwargs)

    @property
    def is_valid(self) -> bool:
        """Check if token is still valid (not used and not expired)."""
        if self.used_at:
            return False
        return timezone.now() < self.expires_at

    def mark_used(self) -> None:
        """Mark the token as used."""
        self.used_at = timezone.now()
        self.save(update_fields=["used_at"])


class EmailChangeToken(models.Model):
    """
    Token for email change requests.
    Sent to the new email address for verification.
    Tokens are single-use and expire after 1 hour.
    """

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="email_change_tokens",
    )
    new_email = models.EmailField()
    token = models.CharField(max_length=64, unique=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        status = "used" if self.used_at else ("expired" if not self.is_valid else "active")
        return f"Email change for {self.user.email} → {self.new_email} ({status})"

    def save(self, *args: object, **kwargs: object) -> None:
        """Generate token and set expiry on first save."""
        if not self.token:
            self.token = secrets.token_urlsafe(48)
        if not self.expires_at:
            self.expires_at = timezone.now() + timedelta(hours=1)
        super().save(*args, **kwargs)

    @property
    def is_valid(self) -> bool:
        """Check if token is still valid (not used and not expired)."""
        if self.used_at:
            return False
        return timezone.now() < self.expires_at

    def mark_used(self) -> None:
        """Mark the token as used."""
        self.used_at = timezone.now()
        self.save(update_fields=["used_at"])
