"""
User models for KB Intra community platform.
"""

from __future__ import annotations

import secrets
from datetime import timedelta
from typing import TYPE_CHECKING

from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models
from django.utils import timezone

if TYPE_CHECKING:
    from apps.houses.models import House


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


class User(AbstractUser):
    """
    Custom User model for KB Intra.
    Uses email as the unique identifier instead of username.
    """

    username = None  # type: ignore[assignment]
    email = models.EmailField("email address", unique=True)

    # Profile fields
    phone_number = models.CharField(max_length=20, blank=True)
    birthdate = models.DateField(null=True, blank=True)
    profile_picture = models.ImageField(
        upload_to="profile_pictures/",
        null=True,
        blank=True,
    )
    bio = models.TextField(blank=True, max_length=500)

    # House relationship (nullable - user might not be assigned to a house yet)
    house = models.ForeignKey(
        "houses.House",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="inhabitants",
    )

    # Food team related fields
    is_exempt_from_food_teams = models.BooleanField(
        default=False,
        help_text="User is exempt from food team duty (e.g., buyers, special circumstances)",
    )
    is_over_50 = models.BooleanField(
        default=False,
        help_text="User is over 50 (max 2 per team for balance)",
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
    food_team_comment = models.TextField(
        blank=True,
        help_text="Special notes about food team participation",
    )

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    objects: UserManager = UserManager()

    class Meta:
        ordering = ["first_name", "last_name"]

    def __str__(self) -> str:
        return self.get_full_name() or self.email

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
