"""
Pytest configuration and fixtures for kbintra backend tests.
"""

from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.food.models import (
    CycleStatus,
    DailyMenu,
    DayOfWeek,
    DiningOption,
    FoodTeam,
    FoodTeamCycle,
    FoodTeamMember,
    FoodTeamWish,
    FoodTicket,
    MealPreference,
    MealRegistration,
    MealType,
    MenuTemplate,
    SeatingTime,
    WeeklyMenu,
)
from apps.forum.models import Folder, Post, Subgroup, SubgroupSubscription, Thread
from apps.houses.models import House
from apps.users.models import User


@pytest.fixture
def api_client():
    """Return an API client instance."""
    return APIClient()


@pytest.fixture
def user(db):
    """Create a test user."""
    return User.objects.create_user(
        email="test@example.com",
        password="testpass123",
        first_name="Test",
        last_name="User",
    )


@pytest.fixture
def admin_user(db):
    """Create a test admin user."""
    return User.objects.create_superuser(
        email="admin@example.com",
        password="adminpass123",
        first_name="Admin",
        last_name="User",
    )


@pytest.fixture
def house(db):
    """Create a test house."""
    return House.objects.create(
        name="House 1",
        description="Test house",
        address="123 Test Street",
    )


@pytest.fixture
def house2(db):
    """Create a second test house."""
    return House.objects.create(
        name="House 2",
        description="Second test house",
        address="456 Test Avenue",
    )


@pytest.fixture
def user_with_house(db, house):
    """Create a test user assigned to a house."""
    return User.objects.create_user(
        email="houseuser@example.com",
        password="testpass123",
        first_name="House",
        last_name="User",
        house=house,
    )


@pytest.fixture
def authenticated_client(api_client, user):
    """Return an authenticated API client."""
    api_client.force_authenticate(user=user)
    return api_client


@pytest.fixture
def admin_client(api_client, admin_user):
    """Return an authenticated admin API client."""
    api_client.force_authenticate(user=admin_user)
    return api_client


@pytest.fixture
def menu_template(db):
    """Create a test menu template."""
    return MenuTemplate.objects.create(
        name="Test Lasagne",
        description="Delicious homemade lasagne",
        has_meat_option=True,
        meat_description="Classic beef lasagne",
        vegetarian_description="Vegetable lasagne",
    )


@pytest.fixture
def menu_template_simple(db):
    """Create a simple test menu template without meat option."""
    return MenuTemplate.objects.create(
        name="Vegetable Stir Fry",
        description="Fresh vegetable stir fry with rice",
        has_meat_option=False,
    )


@pytest.fixture
def monday_date(request):
    """Return a unique Monday date for each test."""
    import hashlib

    # Generate a unique offset based on test name
    test_name = request.node.name if hasattr(request, "node") else "default"
    hash_int = int(hashlib.md5(test_name.encode()).hexdigest()[:8], 16) % 1000
    # Start from a far future Monday to avoid conflicts with existing data
    base_date = timezone.now().date() + timedelta(weeks=100)
    days_until_monday = (7 - base_date.weekday()) % 7
    return base_date + timedelta(days=days_until_monday) + timedelta(weeks=hash_int)


@pytest.fixture
def weekly_menu(db, user, monday_date):
    """Create a test weekly menu."""
    # Use get_or_create to handle any existing data
    menu, created = WeeklyMenu.objects.get_or_create(
        week_start_date=monday_date,
        defaults={"created_by": user},
    )
    if not created:
        # Update the created_by if menu already exists
        menu.created_by = user
        menu.save()
    # Create daily menus for Mon-Thu if they don't exist
    for day in range(4):
        DailyMenu.objects.get_or_create(
            weekly_menu=menu,
            date=monday_date + timedelta(days=day),
            defaults={
                "day_of_week": day,
                "has_meat_option": (day == DayOfWeek.WEDNESDAY),
            },
        )
    return menu


@pytest.fixture
def meal_preference(db, user):
    """Create a test meal preference."""
    return MealPreference.objects.create(
        user=user,
        day_of_week=DayOfWeek.MONDAY,
        adults_count=2,
        children_count=1,
        prefers_meat=True,
        dining_option=DiningOption.EAT_IN,
        seating_time=SeatingTime.FIRST,
    )


@pytest.fixture
def meal_registration(db, user, monday_date):
    """Create a test meal registration."""
    return MealRegistration.objects.create(
        user=user,
        date=monday_date,
        adults_count=2,
        children_count=1,
        meal_type=MealType.MEAT,
        dining_option=DiningOption.EAT_IN,
        seating_time=SeatingTime.FIRST,
        is_active=True,
    )


@pytest.fixture
def food_ticket(db, user, monday_date):
    """Create a test food ticket."""
    return FoodTicket.objects.create(
        owner=user,
        date=monday_date,
        adults_count=1,
        children_count=0,
        meal_type=MealType.MEAT,
        price=Decimal("50.00"),
        description="Can't make it, ticket available!",
        is_available=True,
    )


@pytest.fixture
def food_ticket_free(db, user, monday_date):
    """Create a free food ticket."""
    return FoodTicket.objects.create(
        owner=user,
        date=monday_date + timedelta(days=1),
        adults_count=2,
        children_count=0,
        meal_type=MealType.VEGETARIAN,
        price=None,
        is_available=True,
    )


def generate_cooking_dates(start_date, num_weeks=4):
    """Generate cooking dates (Mon-Thu) for a given number of weeks."""
    dates = []
    current = start_date
    end_date = start_date + timedelta(weeks=num_weeks)
    while current < end_date:
        # Only include Mon-Thu (weekday 0-3)
        if current.weekday() <= 3:
            dates.append(current.isoformat())
        current += timedelta(days=1)
    return dates


@pytest.fixture
def food_team_cycle(db, admin_user, monday_date):
    """Create a test food team cycle."""
    cooking_dates = generate_cooking_dates(monday_date, num_weeks=4)
    return FoodTeamCycle.objects.create(
        name="Test Cycle",
        cooking_dates=cooking_dates,
        wish_deadline=timezone.now() + timedelta(days=7),
        status=CycleStatus.COLLECTING_WISHES,
        created_by=admin_user,
    )


@pytest.fixture
def food_team(db, food_team_cycle, monday_date):
    """Create a test food team."""
    return FoodTeam.objects.create(
        cycle=food_team_cycle,
        date=monday_date,
        notes="Test team",
    )


@pytest.fixture
def food_team_member(db, food_team, user):
    """Create a test food team member."""
    return FoodTeamMember.objects.create(
        team=food_team,
        user=user,
        house_number="1",
    )


@pytest.fixture
def food_team_wish(db, food_team_cycle, user, monday_date):
    """Create a test food team wish."""
    available_dates = [
        (monday_date + timedelta(days=i)).isoformat()
        for i in range(16)
        if (monday_date + timedelta(days=i)).weekday() <= 3  # Mon-Thu only
    ]
    return FoodTeamWish.objects.create(
        cycle=food_team_cycle,
        user=user,
        available_dates=available_dates,
        comment="Flexible on dates",
    )


@pytest.fixture
def multiple_users(db, house, house2):
    """Create multiple users for team generation testing."""
    users = []
    for i in range(12):
        user = User.objects.create_user(
            email=f"user{i}@example.com",
            password="testpass123",
            first_name=f"User{i}",
            last_name="Test",
            house=house if i % 2 == 0 else house2,
            is_over_50=(i < 3),
            can_be_head_chef=(i < 4),
        )
        users.append(user)
    return users


# =============================================================================
# Forum Fixtures
# =============================================================================


@pytest.fixture
def subgroup(db):
    """Create a test subgroup."""
    return Subgroup.objects.create(
        name="General Discussion",
        description="A place for general topics",
        slug="general-discussion",
    )


@pytest.fixture
def committee_subgroup(db):
    """Create a test committee subgroup (udvalg)."""
    return Subgroup.objects.create(
        name="Madudvalg",
        description="Food committee",
        slug="madudvalg",
        is_committee=True,
    )


@pytest.fixture
def subgroup_subscription(db, user, subgroup):
    """Create a test subgroup subscription."""
    return SubgroupSubscription.objects.create(
        user=user,
        subgroup=subgroup,
        notify_new_threads=True,
        notify_replies=True,
    )


@pytest.fixture
def thread(db, user, subgroup):
    """Create a test thread."""
    return Thread.objects.create(
        subgroup=subgroup,
        title="Test Thread",
        author=user,
    )


@pytest.fixture
def pinned_thread(db, user, subgroup):
    """Create a pinned test thread."""
    return Thread.objects.create(
        subgroup=subgroup,
        title="Pinned Thread",
        author=user,
        is_pinned=True,
    )


@pytest.fixture
def post(db, user, thread):
    """Create a test post."""
    return Post.objects.create(
        thread=thread,
        author=user,
        content="This is a test post content.",
    )


@pytest.fixture
def folder(db, subgroup):
    """Create a test folder."""
    return Folder.objects.create(
        subgroup=subgroup,
        name="Test Folder",
    )


@pytest.fixture
def subfolder(db, subgroup, folder):
    """Create a test subfolder."""
    return Folder.objects.create(
        subgroup=subgroup,
        name="Test Subfolder",
        parent=folder,
    )


@pytest.fixture
def second_user(db):
    """Create a second test user."""
    return User.objects.create_user(
        email="second@example.com",
        password="testpass123",
        first_name="Second",
        last_name="User",
    )
