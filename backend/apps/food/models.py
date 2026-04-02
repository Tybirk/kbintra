"""
Models for Food app.

The food module handles:
- Weekly menus (Mon-Thu dinner)
- Meal registration (how many adults/children, meat/veg on Wed)
- Default preferences per user
- Food ticket trading (offer unused meal spots)
"""

from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models


class DayOfWeek(models.IntegerChoices):
    """Days when dinner is served (Mon-Thu)."""

    MONDAY = 0, "Mandag"
    TUESDAY = 1, "Tirsdag"
    WEDNESDAY = 2, "Onsdag"
    THURSDAY = 3, "Torsdag"


class DiningOption(models.TextChoices):
    """Dining options for meal registration."""

    EAT_IN = "eat_in", "Spis i fælleshuset"
    TAKE_AWAY = "take_away", "Tag med"


class SeatingTime(models.TextChoices):
    """Seating time options."""

    FIRST = "17:30", "17:30"
    SECOND = "18:30", "18:30"


class MealPreference(models.Model):
    """Default meal preferences per house per day of week."""

    house = models.ForeignKey(
        "houses.House",
        on_delete=models.CASCADE,
        related_name="meal_preferences",
    )
    last_modified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="modified_preferences",
    )
    day_of_week = models.IntegerField(choices=DayOfWeek.choices)
    adults_meat = models.PositiveIntegerField(default=0, validators=[MinValueValidator(0)])
    adults_veg = models.PositiveIntegerField(default=1, validators=[MinValueValidator(0)])
    children_count = models.PositiveIntegerField(
        default=0,
        validators=[MinValueValidator(0)],
    )
    dining_option = models.CharField(
        max_length=20,
        choices=DiningOption.choices,
        default=DiningOption.EAT_IN,
        help_text="Default dining preference (eat in or take away)",
    )
    seating_time = models.CharField(
        max_length=10,
        choices=SeatingTime.choices,
        default=SeatingTime.FIRST,
        help_text="Default seating time preference",
    )

    class Meta:
        unique_together = ["house", "day_of_week"]

    @property
    def adults_count(self) -> int:
        return self.adults_meat + self.adults_veg

    def __str__(self) -> str:
        return f"House {self.house.name} - {self.get_day_of_week_display()}"


class MealRegistration(models.Model):
    """Meal registration for a specific date, per house."""

    house = models.ForeignKey(
        "houses.House",
        on_delete=models.CASCADE,
        related_name="meal_registrations",
    )
    last_modified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="modified_registrations",
    )
    date = models.DateField()
    adults_meat = models.PositiveIntegerField(default=0, validators=[MinValueValidator(0)])
    adults_veg = models.PositiveIntegerField(default=1, validators=[MinValueValidator(0)])
    children_count = models.PositiveIntegerField(
        default=0,
        validators=[MinValueValidator(0)],
    )
    dining_option = models.CharField(
        max_length=20,
        choices=DiningOption.choices,
        default=DiningOption.EAT_IN,
        help_text="Eat in or take away",
    )
    seating_time = models.CharField(
        max_length=10,
        choices=SeatingTime.choices,
        default=SeatingTime.FIRST,
        help_text="17:30 or 18:30 seating",
    )
    is_active = models.BooleanField(
        default=True,
        help_text="False if house cancelled this registration",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ["house", "date"]
        ordering = ["date"]

    def __str__(self) -> str:
        return f"House {self.house.name} - {self.date}"

    @property
    def adults_count(self) -> int:
        return self.adults_meat + self.adults_veg

    @property
    def total_portions(self) -> int:
        """Total number of portions (adults + children)."""
        return self.adults_meat + self.adults_veg + self.children_count


class FoodTicket(models.Model):
    """
    Food ticket for trading unused meal spots.

    Users can offer their meal spots for free or for a price.
    Payment is handled externally (MobilePay etc.).
    """

    house = models.ForeignKey(
        "houses.House",
        on_delete=models.CASCADE,
        related_name="house_food_tickets",
        help_text="The house whose registration these portions come from",
    )
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="food_tickets",
        help_text="The user who created this ticket listing",
    )
    date = models.DateField()
    adults_meat = models.PositiveIntegerField(default=0, validators=[MinValueValidator(0)])
    adults_veg = models.PositiveIntegerField(default=1, validators=[MinValueValidator(0)])
    children_count = models.PositiveIntegerField(
        default=0,
        validators=[MinValueValidator(0)],
    )
    price = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0.00"))],
        help_text="Price in DKK. Leave empty for free.",
    )
    description = models.TextField(
        blank=True,
        help_text="Optional note from seller",
    )
    is_available = models.BooleanField(default=True)
    claimed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="claimed_tickets",
    )
    claimed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["date", "-created_at"]

    def __str__(self) -> str:
        status = "Available" if self.is_available else "Claimed"
        return f"{self.owner.email} - {self.date} ({status})"

    @property
    def is_free(self) -> bool:
        """Whether this ticket is offered for free."""
        return self.price is None or self.price == 0

    @property
    def adults_count(self) -> int:
        return self.adults_meat + self.adults_veg

    @property
    def total_portions(self) -> int:
        """Total number of portions being offered."""
        return self.adults_meat + self.adults_veg + self.children_count


class SwapRequestStatus(models.TextChoices):
    """Status options for team swap requests."""

    PENDING = "pending", "Afventer"
    ACCEPTED = "accepted", "Accepteret"
    DECLINED = "declined", "Afvist"
    CANCELLED = "cancelled", "Annulleret"


class FoodTeam(models.Model):
    """
    Food team for a specific cooking date.

    Each day (Mon-Thu) has a team of ~6 people responsible for cooking.
    Teams are typically scheduled in cycles of 16 days (4 weeks).
    """

    cycle = models.ForeignKey(
        "FoodTeamCycle",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="teams",
        help_text="The cycle this team belongs to",
    )
    date = models.DateField(
        unique=True,
        help_text="The date this team is cooking",
    )
    notes = models.TextField(
        blank=True,
        help_text="Optional notes about this team/day",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["date"]

    def __str__(self) -> str:
        return f"Team for {self.date}"

    @property
    def day_name(self) -> str:
        """Get the day name for this date."""
        from .constants import DAY_NAMES

        return DAY_NAMES[self.date.weekday()]

    @property
    def member_count(self) -> int:
        """Get the number of team members."""
        return self.members.count()


class FoodTeamMember(models.Model):
    """
    Member of a food team.

    Links a user to a specific cooking date.
    """

    team = models.ForeignKey(
        FoodTeam,
        on_delete=models.CASCADE,
        related_name="members",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="food_team_memberships",
    )
    # Store house info at time of assignment for display purposes
    house_number = models.CharField(
        max_length=20,
        blank=True,
        help_text="House number at time of assignment (for display)",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["team__date", "user__first_name"]
        unique_together = ["team", "user"]

    def __str__(self) -> str:
        return f"{self.user.first_name} ({self.house_number}) - {self.team.date}"


class TeamSwapRequest(models.Model):
    """
    Request to swap team assignments between two users.

    A user can request to swap their team date with another user's date.
    The target user must accept/decline the request.
    """

    requester = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="sent_swap_requests",
        help_text="User requesting the swap",
    )
    requester_membership = models.ForeignKey(
        FoodTeamMember,
        on_delete=models.CASCADE,
        related_name="outgoing_swap_requests",
        help_text="The requester's team membership to swap",
    )
    target_membership = models.ForeignKey(
        FoodTeamMember,
        on_delete=models.CASCADE,
        related_name="incoming_swap_requests",
        help_text="The target's team membership to swap with",
    )
    status = models.CharField(
        max_length=20,
        choices=SwapRequestStatus.choices,
        default=SwapRequestStatus.PENDING,
    )
    message = models.TextField(
        blank=True,
        help_text="Optional message from requester",
    )
    response_message = models.TextField(
        blank=True,
        help_text="Optional response message",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return (
            f"{self.requester.first_name} ({self.requester_membership.team.date}) "
            f"<-> {self.target_membership.user.first_name} ({self.target_membership.team.date})"
        )

    @property
    def target_user(self):
        """Get the target user from the target membership."""
        return self.target_membership.user


class CycleStatus(models.TextChoices):
    """Status options for food team cycles."""

    COLLECTING_WISHES = "collecting_wishes", "Indsamler ønsker"
    GENERATING = "generating", "Genererer hold"
    FINALIZED = "finalized", "Afsluttet"
    ARCHIVED = "archived", "Arkiveret"


class FoodTeamCycle(models.Model):
    """
    A food team cycle represents a period for which teams are scheduled.

    Typically covers 4 weeks (16 cooking days, Mon-Thu).
    Users submit wishes for dates they can cook, then teams are generated.
    """

    name = models.CharField(
        max_length=100,
        help_text="Descriptive name for the cycle (e.g., 'December 2025 - January 2026')",
    )
    cooking_dates = models.JSONField(
        default=list,
        help_text="List of cooking dates (ISO format strings: YYYY-MM-DD)",
    )
    wish_deadline = models.DateTimeField(
        help_text="Deadline for submitting date wishes",
    )
    status = models.CharField(
        max_length=20,
        choices=CycleStatus.choices,
        default=CycleStatus.COLLECTING_WISHES,
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="created_cycles",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        if self.cooking_dates:
            first = self.cooking_dates[0]
            last = self.cooking_dates[-1]
            return f"{self.name} ({first} - {last})"
        return self.name

    @property
    def first_date(self) -> str | None:
        """Get the first cooking date."""
        return self.cooking_dates[0] if self.cooking_dates else None

    @property
    def last_date(self) -> str | None:
        """Get the last cooking date."""
        return self.cooking_dates[-1] if self.cooking_dates else None

    @property
    def is_accepting_wishes(self) -> bool:
        """Check if the cycle is still accepting wishes."""
        from django.utils import timezone

        return self.status == CycleStatus.COLLECTING_WISHES and timezone.now() < self.wish_deadline


class FoodTeamWish(models.Model):
    """
    A user's wish for which dates they can cook in a cycle.

    Users select multiple dates they are available for.
    """

    cycle = models.ForeignKey(
        FoodTeamCycle,
        on_delete=models.CASCADE,
        related_name="wishes",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="food_team_wishes",
    )
    available_dates = models.JSONField(
        default=list,
        help_text="List of date strings (YYYY-MM-DD) the user is available",
    )
    comment = models.TextField(
        blank=True,
        help_text="Optional comment or special requests",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ["cycle", "user"]
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.user.first_name}'s wishes for {self.cycle.name}"

    @property
    def available_date_count(self) -> int:
        """Number of dates the user selected."""
        return len(self.available_dates)


class DriveMenuCache(models.Model):
    """
    Cache for menus fetched from Google Drive.

    Stores parsed menu data to avoid frequent API calls.
    Each record represents one week's menu.
    """

    week_number = models.PositiveIntegerField(
        help_text="ISO week number (1-53)",
    )
    year = models.PositiveIntegerField(
        help_text="Year for the week",
    )
    monday_menu = models.TextField(
        blank=True,
        help_text="Monday's menu description",
    )
    tuesday_menu = models.TextField(
        blank=True,
        help_text="Tuesday's menu description",
    )
    wednesday_menu = models.TextField(
        blank=True,
        help_text="Wednesday's menu description",
    )
    thursday_menu = models.TextField(
        blank=True,
        help_text="Thursday's menu description",
    )
    raw_content = models.TextField(
        blank=True,
        help_text="Raw content from the document (for debugging)",
    )
    drive_file_id = models.CharField(
        max_length=100,
        blank=True,
        help_text="Google Drive file ID for reference",
    )
    drive_folder_id = models.CharField(
        max_length=100,
        blank=True,
        help_text="Google Drive week folder ID (used for linking to the specific week's folder)",
    )
    fetched_at = models.DateTimeField(
        auto_now=True,
        help_text="When this menu was last fetched from Drive",
    )

    class Meta:
        unique_together = ["week_number", "year"]
        ordering = ["-year", "-week_number"]

    def __str__(self) -> str:
        return f"Week {self.week_number}, {self.year}"

    def is_stale(self, max_age_hours: int = 12) -> bool:
        """Check if the cache entry is older than max_age_hours."""
        from datetime import timedelta

        from django.utils import timezone

        return timezone.now() - self.fetched_at > timedelta(hours=max_age_hours)
