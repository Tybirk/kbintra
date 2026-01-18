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

    MONDAY = 0, "Monday"
    TUESDAY = 1, "Tuesday"
    WEDNESDAY = 2, "Wednesday"
    THURSDAY = 3, "Thursday"


class MealType(models.TextChoices):
    """Meal type options (mainly for Wednesday)."""

    MEAT = "meat", "Meat"
    VEGETARIAN = "vegetarian", "Vegetarian"


class DiningOption(models.TextChoices):
    """Dining options for meal registration."""

    EAT_IN = "eat_in", "Eat In"
    TAKE_AWAY = "take_away", "Take Away"


class SeatingTime(models.TextChoices):
    """Seating time options."""

    FIRST = "17:30", "17:30"
    SECOND = "18:30", "18:30"


class MenuTemplate(models.Model):
    """
    Reusable menu template.

    The community has ~14 distinct menus they cycle through.
    Templates make it easy to assign menus to upcoming weeks.
    """

    name = models.CharField(
        max_length=100,
        unique=True,
        help_text="Short name/header for the menu (e.g., 'Lasagne', 'Thai Curry')",
    )
    description = models.TextField(
        blank=True,
        help_text="Full description of the menu",
    )
    has_meat_option = models.BooleanField(
        default=False,
        help_text="Whether this menu has separate meat/vegetarian options",
    )
    meat_description = models.TextField(
        blank=True,
        help_text="Description of meat option (if applicable)",
    )
    vegetarian_description = models.TextField(
        blank=True,
        help_text="Description of vegetarian option (if applicable)",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class WeeklyMenu(models.Model):
    """Weekly menu container."""

    week_start_date = models.DateField(
        unique=True,
        help_text="Monday of the menu week",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="created_menus",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-week_start_date"]

    def __str__(self) -> str:
        return f"Menu for week of {self.week_start_date}"


class DailyMenu(models.Model):
    """Daily menu for a specific day."""

    weekly_menu = models.ForeignKey(
        WeeklyMenu,
        on_delete=models.CASCADE,
        related_name="daily_menus",
    )
    date = models.DateField()
    day_of_week = models.IntegerField(choices=DayOfWeek.choices)
    # Link to reusable menu template
    template = models.ForeignKey(
        MenuTemplate,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="daily_menus",
        help_text="Optional link to a reusable menu template",
    )
    description = models.TextField(
        blank=True,
        help_text="Main menu description (overrides template if set)",
    )
    # Wednesday has meat/vegetarian options
    has_meat_option = models.BooleanField(
        default=False,
        help_text="Whether this day has separate meat/vegetarian options",
    )
    meat_description = models.TextField(
        blank=True,
        help_text="Description of meat option (if applicable)",
    )
    vegetarian_description = models.TextField(
        blank=True,
        help_text="Description of vegetarian option (if applicable)",
    )

    @property
    def menu_name(self) -> str:
        """Get the menu name from template or return empty."""
        return self.template.name if self.template else ""

    @property
    def effective_description(self) -> str:
        """Get description, preferring local override over template."""
        if self.description:
            return self.description
        return self.template.description if self.template else ""

    @property
    def effective_meat_description(self) -> str:
        """Get meat description, preferring local override over template."""
        if self.meat_description:
            return self.meat_description
        return self.template.meat_description if self.template else ""

    @property
    def effective_vegetarian_description(self) -> str:
        """Get vegetarian description, preferring local override over template."""
        if self.vegetarian_description:
            return self.vegetarian_description
        return self.template.vegetarian_description if self.template else ""

    class Meta:
        ordering = ["date"]
        unique_together = ["weekly_menu", "date"]

    def __str__(self) -> str:
        return f"{self.get_day_of_week_display()} - {self.date}"


class MealPreference(models.Model):
    """Default meal preferences per user per day of week."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="meal_preferences",
    )
    day_of_week = models.IntegerField(choices=DayOfWeek.choices)
    adults_count = models.PositiveIntegerField(
        default=1,
        validators=[MinValueValidator(0)],
    )
    children_count = models.PositiveIntegerField(
        default=0,
        validators=[MinValueValidator(0)],
    )
    prefers_meat = models.BooleanField(
        default=True,
        help_text="Preference for Wednesday meat/vegetarian option",
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
        unique_together = ["user", "day_of_week"]

    def __str__(self) -> str:
        return f"{self.user.email} - {self.get_day_of_week_display()}"


class MealRegistration(models.Model):
    """Actual meal registration for a specific date."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="meal_registrations",
    )
    # House registration - allows registering on behalf of whole house
    house = models.ForeignKey(
        "houses.House",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="meal_registrations",
        help_text="If set, this is a registration on behalf of the house",
    )
    date = models.DateField()
    adults_count = models.PositiveIntegerField(
        default=1,
        validators=[MinValueValidator(0)],
    )
    children_count = models.PositiveIntegerField(
        default=0,
        validators=[MinValueValidator(0)],
    )
    meal_type = models.CharField(
        max_length=20,
        choices=MealType.choices,
        default=MealType.MEAT,
        help_text="Only relevant for Wednesday",
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
        help_text="False if user cancelled this registration",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ["user", "date"]
        ordering = ["date"]

    def __str__(self) -> str:
        if self.house:
            return f"House {self.house.name} - {self.date}"
        return f"{self.user.email} - {self.date}"

    @property
    def total_portions(self) -> int:
        """Total number of portions (adults + children)."""
        return self.adults_count + self.children_count


class FoodTicket(models.Model):
    """
    Food ticket for trading unused meal spots.

    Users can offer their meal spots for free or for a price.
    Payment is handled externally (MobilePay etc.).
    """

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="food_tickets",
    )
    date = models.DateField()
    adults_count = models.PositiveIntegerField(
        default=1,
        validators=[MinValueValidator(0)],
    )
    children_count = models.PositiveIntegerField(
        default=0,
        validators=[MinValueValidator(0)],
    )
    meal_type = models.CharField(
        max_length=20,
        choices=MealType.choices,
        default=MealType.MEAT,
        help_text="Only relevant for Wednesday",
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
    def total_portions(self) -> int:
        """Total number of portions being offered."""
        return self.adults_count + self.children_count


class SwapRequestStatus(models.TextChoices):
    """Status options for team swap requests."""

    PENDING = "pending", "Pending"
    ACCEPTED = "accepted", "Accepted"
    DECLINED = "declined", "Declined"
    CANCELLED = "cancelled", "Cancelled"


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
        return self.date.strftime("%A")

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

    COLLECTING_WISHES = "collecting_wishes", "Collecting Wishes"
    GENERATING = "generating", "Generating Teams"
    FINALIZED = "finalized", "Finalized"
    ARCHIVED = "archived", "Archived"


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
