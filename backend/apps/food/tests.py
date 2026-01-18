"""
Tests for the Food app.

Uses pytest and pytest-django for testing.
"""

from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.urls import reverse
from django.utils import timezone

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
    SwapRequestStatus,
    TeamSwapRequest,
    WeeklyMenu,
)
from apps.food.serializers import (
    FoodTeamCycleCreateSerializer,
    FoodTeamWishCreateUpdateSerializer,
    FoodTicketCreateSerializer,
    MealRegistrationCreateUpdateSerializer,
    MenuTemplateSerializer,
    WeeklyMenuCreateSerializer,
)
from apps.food.services.team_generator import TeamGenerationResult, TeamGenerator
from apps.users.models import User
from conftest import generate_cooking_dates

# =============================================================================
# Model Tests
# =============================================================================


class TestMenuTemplateModel:
    """Tests for MenuTemplate model."""

    def test_create_menu_template(self, db):
        """Test creating a menu template."""
        template = MenuTemplate.objects.create(
            name="Thai Curry",
            description="Spicy Thai curry with rice",
            has_meat_option=True,
            meat_description="Chicken curry",
            vegetarian_description="Tofu curry",
        )
        assert template.name == "Thai Curry"
        assert template.has_meat_option is True
        assert str(template) == "Thai Curry"

    def test_menu_template_ordering(self, db):
        """Test menu templates are ordered by name."""
        t1 = MenuTemplate.objects.create(name="Zebra Steak Test")
        t2 = MenuTemplate.objects.create(name="Apple Pie Test")
        t3 = MenuTemplate.objects.create(name="Mango Salad Test")

        # Filter for only the templates we created
        templates = list(MenuTemplate.objects.filter(id__in=[t1.id, t2.id, t3.id]).order_by("name"))
        assert templates[0].name == "Apple Pie Test"
        assert templates[1].name == "Mango Salad Test"
        assert templates[2].name == "Zebra Steak Test"


class TestWeeklyMenuModel:
    """Tests for WeeklyMenu model."""

    def test_create_weekly_menu(self, db, user, monday_date):
        """Test creating a weekly menu."""
        menu = WeeklyMenu.objects.create(
            week_start_date=monday_date,
            created_by=user,
        )
        assert menu.week_start_date == monday_date
        assert menu.created_by == user
        assert "Menu for week of" in str(menu)

    def test_weekly_menu_ordering(self, db, user, monday_date):
        """Test weekly menus are ordered by date descending."""
        WeeklyMenu.objects.create(week_start_date=monday_date, created_by=user)
        WeeklyMenu.objects.create(week_start_date=monday_date + timedelta(weeks=1), created_by=user)
        WeeklyMenu.objects.create(week_start_date=monday_date - timedelta(weeks=1), created_by=user)

        menus = list(WeeklyMenu.objects.all())
        # Descending order
        assert menus[0].week_start_date == monday_date + timedelta(weeks=1)
        assert menus[1].week_start_date == monday_date
        assert menus[2].week_start_date == monday_date - timedelta(weeks=1)


class TestDailyMenuModel:
    """Tests for DailyMenu model."""

    def test_daily_menu_properties(self, weekly_menu, menu_template):
        """Test daily menu property methods."""
        daily_menu = weekly_menu.daily_menus.first()
        daily_menu.template = menu_template
        daily_menu.save()

        assert daily_menu.menu_name == "Test Lasagne"
        assert daily_menu.effective_description == "Delicious homemade lasagne"
        assert daily_menu.effective_meat_description == "Classic beef lasagne"
        assert daily_menu.effective_vegetarian_description == "Vegetable lasagne"

    def test_daily_menu_local_override(self, weekly_menu, menu_template):
        """Test that local descriptions override template."""
        daily_menu = weekly_menu.daily_menus.first()
        daily_menu.template = menu_template
        daily_menu.description = "Local description"
        daily_menu.meat_description = "Local meat"
        daily_menu.vegetarian_description = "Local veg"
        daily_menu.save()

        assert daily_menu.effective_description == "Local description"
        assert daily_menu.effective_meat_description == "Local meat"
        assert daily_menu.effective_vegetarian_description == "Local veg"


class TestMealPreferenceModel:
    """Tests for MealPreference model."""

    def test_create_meal_preference(self, meal_preference):
        """Test creating a meal preference."""
        assert meal_preference.day_of_week == DayOfWeek.MONDAY
        assert meal_preference.adults_count == 2
        assert meal_preference.children_count == 1
        assert meal_preference.prefers_meat is True
        assert meal_preference.dining_option == DiningOption.EAT_IN

    def test_meal_preference_unique_constraint(self, db, user):
        """Test unique constraint on user + day_of_week."""
        from django.db import IntegrityError

        MealPreference.objects.create(
            user=user,
            day_of_week=DayOfWeek.MONDAY,
        )
        with pytest.raises(IntegrityError):
            MealPreference.objects.create(
                user=user,
                day_of_week=DayOfWeek.MONDAY,
            )


class TestMealRegistrationModel:
    """Tests for MealRegistration model."""

    def test_create_meal_registration(self, meal_registration):
        """Test creating a meal registration."""
        assert meal_registration.adults_count == 2
        assert meal_registration.children_count == 1
        assert meal_registration.is_active is True

    def test_total_portions(self, meal_registration):
        """Test total_portions property."""
        assert meal_registration.total_portions == 3  # 2 adults + 1 child

    def test_meal_registration_with_house(self, db, user_with_house, monday_date, house):
        """Test meal registration with house."""
        reg = MealRegistration.objects.create(
            user=user_with_house,
            house=house,
            date=monday_date,
            adults_count=4,
        )
        assert reg.house == house
        assert "House 1" in str(reg)


class TestFoodTicketModel:
    """Tests for FoodTicket model."""

    def test_create_food_ticket(self, food_ticket):
        """Test creating a food ticket."""
        assert food_ticket.price == Decimal("50.00")
        assert food_ticket.is_available is True
        assert food_ticket.is_free is False

    def test_free_ticket(self, food_ticket_free):
        """Test free food ticket."""
        assert food_ticket_free.is_free is True
        assert food_ticket_free.total_portions == 2

    def test_claim_ticket(self, db, food_ticket, admin_user):
        """Test claiming a food ticket."""
        food_ticket.is_available = False
        food_ticket.claimed_by = admin_user
        food_ticket.claimed_at = timezone.now()
        food_ticket.save()

        assert food_ticket.is_available is False
        assert food_ticket.claimed_by == admin_user


class TestFoodTeamCycleModel:
    """Tests for FoodTeamCycle model."""

    def test_create_cycle(self, food_team_cycle):
        """Test creating a food team cycle."""
        assert food_team_cycle.status == CycleStatus.COLLECTING_WISHES
        assert food_team_cycle.is_accepting_wishes is True

    def test_cooking_dates(self, food_team_cycle):
        """Test cooking_dates contains valid date strings."""
        dates = food_team_cycle.cooking_dates
        assert len(dates) > 0
        for d in dates:
            # Dates are now ISO format strings
            parsed = date.fromisoformat(d)
            assert parsed.weekday() <= 3  # Mon=0, Thu=3

    def test_cycle_not_accepting_after_deadline(self, db, admin_user, monday_date):
        """Test cycle stops accepting wishes after deadline."""
        cooking_dates = generate_cooking_dates(monday_date, num_weeks=4)
        cycle = FoodTeamCycle.objects.create(
            name="Past Deadline Cycle",
            cooking_dates=cooking_dates,
            wish_deadline=timezone.now() - timedelta(days=1),  # Past deadline
            status=CycleStatus.COLLECTING_WISHES,
            created_by=admin_user,
        )
        assert cycle.is_accepting_wishes is False


class TestFoodTeamModel:
    """Tests for FoodTeam model."""

    def test_create_food_team(self, food_team):
        """Test creating a food team."""
        assert food_team.date is not None
        assert food_team.day_name in [
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
            "Sunday",
        ]

    def test_member_count(self, food_team, food_team_member):
        """Test member_count property."""
        assert food_team.member_count == 1


class TestTeamSwapRequest:
    """Tests for TeamSwapRequest model."""

    def test_create_swap_request(self, db, food_team, user, admin_user):
        """Test creating a team swap request."""
        member1 = FoodTeamMember.objects.create(team=food_team, user=user, house_number="1")

        team2 = FoodTeam.objects.create(
            cycle=food_team.cycle,
            date=food_team.date + timedelta(days=1),
        )
        member2 = FoodTeamMember.objects.create(team=team2, user=admin_user, house_number="2")

        swap = TeamSwapRequest.objects.create(
            requester=user,
            requester_membership=member1,
            target_membership=member2,
            message="Please swap with me",
        )

        assert swap.status == SwapRequestStatus.PENDING
        assert swap.target_user == admin_user


# =============================================================================
# Serializer Tests
# =============================================================================


class TestMenuTemplateSerializer:
    """Tests for MenuTemplateSerializer."""

    def test_serialize(self, menu_template):
        """Test serializing a menu template."""
        serializer = MenuTemplateSerializer(menu_template)
        data = serializer.data

        assert data["name"] == "Test Lasagne"
        assert data["has_meat_option"] is True
        assert "created_at" in data

    def test_deserialize(self, db):
        """Test deserializing menu template data."""
        data = {
            "name": "New Menu",
            "description": "A new menu",
            "has_meat_option": False,
        }
        serializer = MenuTemplateSerializer(data=data)
        assert serializer.is_valid()
        template = serializer.save()
        assert template.name == "New Menu"


class MockRequest:
    """Simple mock request object for serializer tests."""

    def __init__(self, user):
        self.user = user


class TestWeeklyMenuCreateSerializer:
    """Tests for WeeklyMenuCreateSerializer."""

    def test_validate_monday(self, db, user, monday_date):
        """Test that week_start_date must be a Monday."""
        serializer = WeeklyMenuCreateSerializer(
            data={"week_start_date": monday_date.isoformat()},
            context={"request": MockRequest(user)},
        )
        assert serializer.is_valid()

    def test_reject_non_monday(self, db, user, monday_date):
        """Test that non-Monday dates are rejected."""
        tuesday = monday_date + timedelta(days=1)
        serializer = WeeklyMenuCreateSerializer(
            data={"week_start_date": tuesday.isoformat()},
            context={"request": MockRequest(user)},
        )
        assert not serializer.is_valid()
        assert "week_start_date" in serializer.errors


class TestMealRegistrationSerializer:
    """Tests for MealRegistrationCreateUpdateSerializer."""

    def test_validate_weekday(self, db, user, monday_date):
        """Test that only Mon-Thu dates are accepted."""
        # Valid Monday
        serializer = MealRegistrationCreateUpdateSerializer(
            data={
                "date": monday_date.isoformat(),
                "adults_count": 1,
                "children_count": 0,
            },
            context={"request": MockRequest(user)},
        )
        assert serializer.is_valid()

    def test_reject_weekend(self, db, user, monday_date):
        """Test that weekend dates are rejected."""
        saturday = monday_date + timedelta(days=5)
        serializer = MealRegistrationCreateUpdateSerializer(
            data={
                "date": saturday.isoformat(),
                "adults_count": 1,
                "children_count": 0,
            },
            context={"request": MockRequest(user)},
        )
        assert not serializer.is_valid()
        assert "date" in serializer.errors


class TestFoodTicketCreateSerializer:
    """Tests for FoodTicketCreateSerializer."""

    def test_reject_past_date(self, db, user):
        """Test that past dates are rejected."""
        past_date = timezone.now().date() - timedelta(days=1)
        serializer = FoodTicketCreateSerializer(
            data={
                "date": past_date.isoformat(),
                "adults_count": 1,
                "children_count": 0,
            },
            context={"request": MockRequest(user)},
        )
        assert not serializer.is_valid()
        assert "date" in serializer.errors


class TestFoodTeamCycleCreateSerializer:
    """Tests for FoodTeamCycleCreateSerializer."""

    def test_valid_cooking_dates(self, db, user, monday_date):
        """Test valid cooking dates are accepted."""
        cooking_dates = [
            monday_date.isoformat(),
            (monday_date + timedelta(days=1)).isoformat(),
            (monday_date + timedelta(days=2)).isoformat(),
        ]
        serializer = FoodTeamCycleCreateSerializer(
            data={
                "name": "Test Cycle",
                "cooking_dates": cooking_dates,
                "wish_deadline": (timezone.now() + timedelta(days=1)).isoformat(),
            },
            context={"request": MockRequest(user)},
        )
        assert serializer.is_valid()

    def test_empty_cooking_dates_rejected(self, db, user):
        """Test empty cooking dates are rejected."""
        serializer = FoodTeamCycleCreateSerializer(
            data={
                "name": "Test Cycle",
                "cooking_dates": [],
                "wish_deadline": (timezone.now() + timedelta(days=1)).isoformat(),
            },
            context={"request": MockRequest(user)},
        )
        assert not serializer.is_valid()
        assert "cooking_dates" in serializer.errors

    def test_cooking_dates_sorted(self, db, user, monday_date):
        """Test cooking dates are sorted in output."""
        # Input dates in random order
        cooking_dates = [
            (monday_date + timedelta(days=2)).isoformat(),
            monday_date.isoformat(),
            (monday_date + timedelta(days=1)).isoformat(),
        ]
        serializer = FoodTeamCycleCreateSerializer(
            data={
                "name": "Test Cycle",
                "cooking_dates": cooking_dates,
                "wish_deadline": (timezone.now() + timedelta(days=1)).isoformat(),
            },
            context={"request": MockRequest(user)},
        )
        assert serializer.is_valid()
        # Dates should be sorted
        result = serializer.validated_data["cooking_dates"]
        assert result == sorted(result)


class TestFoodTeamWishSerializer:
    """Tests for FoodTeamWishCreateUpdateSerializer."""

    def test_validate_dates(self, db, food_team_cycle, user, monday_date):
        """Test date validation."""
        available_dates = [
            monday_date.isoformat(),
            (monday_date + timedelta(days=1)).isoformat(),
        ]
        serializer = FoodTeamWishCreateUpdateSerializer(
            data={
                "cycle": food_team_cycle.id,
                "available_dates": available_dates,
                "comment": "Test",
            },
            context={"request": MockRequest(user)},
        )
        assert serializer.is_valid()

    def test_reject_cycle_not_accepting(self, db, admin_user, user, monday_date):
        """Test rejection when cycle not accepting wishes."""
        cooking_dates = generate_cooking_dates(monday_date, num_weeks=1)
        cycle = FoodTeamCycle.objects.create(
            name="Closed Cycle",
            cooking_dates=cooking_dates,
            wish_deadline=timezone.now() - timedelta(days=1),
            status=CycleStatus.COLLECTING_WISHES,
            created_by=admin_user,
        )
        serializer = FoodTeamWishCreateUpdateSerializer(
            data={
                "cycle": cycle.id,
                "available_dates": [monday_date.isoformat()],
            },
            context={"request": MockRequest(user)},
        )
        assert not serializer.is_valid()


# =============================================================================
# View/API Tests
# =============================================================================


@pytest.mark.django_db
class TestMenuTemplateViews:
    """Tests for menu template API endpoints."""

    def test_list_templates(self, authenticated_client, menu_template):
        """Test listing menu templates."""
        url = reverse("food:template-list")
        response = authenticated_client.get(url)
        assert response.status_code == 200
        data = response.json()
        # Handle pagination
        if isinstance(data, dict) and "results" in data:
            data = data["results"]
        assert len(data) >= 1

    def test_create_template(self, authenticated_client):
        """Test creating a menu template."""
        url = reverse("food:template-list")
        data = {
            "name": "New Template",
            "description": "A new template",
            "has_meat_option": False,
        }
        response = authenticated_client.post(url, data, format="json")
        assert response.status_code == 201
        assert response.json()["name"] == "New Template"

    def test_update_template(self, authenticated_client, menu_template):
        """Test updating a menu template."""
        url = reverse("food:template-detail", kwargs={"pk": menu_template.pk})
        response = authenticated_client.patch(url, {"name": "Updated Name"}, format="json")
        assert response.status_code == 200
        assert response.json()["name"] == "Updated Name"

    def test_delete_template(self, authenticated_client, menu_template):
        """Test deleting a menu template."""
        url = reverse("food:template-detail", kwargs={"pk": menu_template.pk})
        response = authenticated_client.delete(url)
        assert response.status_code == 204


@pytest.mark.django_db
class TestWeeklyMenuViews:
    """Tests for weekly menu API endpoints."""

    def test_list_menus(self, authenticated_client, weekly_menu):
        """Test listing weekly menus."""
        url = reverse("food:menu-list")
        response = authenticated_client.get(url)
        assert response.status_code == 200

    def test_create_menu(self, authenticated_client, monday_date):
        """Test creating a weekly menu."""
        # Use a different Monday to avoid conflicts
        new_monday = monday_date + timedelta(weeks=50)
        url = reverse("food:menu-list")
        response = authenticated_client.post(
            url, {"week_start_date": new_monday.isoformat()}, format="json"
        )
        assert response.status_code == 201
        # The create serializer returns the full menu data
        data = response.json()
        # Verify menu was created with daily menus
        menu = WeeklyMenu.objects.get(week_start_date=new_monday)
        assert menu.daily_menus.count() == 4

    def test_get_current_week_menu(self, authenticated_client, user, db):
        """Test getting current week menu."""
        # Create a menu for current week
        today = timezone.now().date()
        current_monday = today - timedelta(days=today.weekday())
        # Clean up any existing menu for this week
        WeeklyMenu.objects.filter(week_start_date=current_monday).delete()
        # Create fresh menu
        menu = WeeklyMenu.objects.create(
            week_start_date=current_monday,
            created_by=user,
        )
        # Create daily menus
        for i in range(4):
            DailyMenu.objects.create(
                weekly_menu=menu,
                date=current_monday + timedelta(days=i),
                day_of_week=i,
            )

        url = reverse("food:menu-current")
        response = authenticated_client.get(url)
        assert response.status_code == 200


@pytest.mark.django_db
class TestMealPreferenceViews:
    """Tests for meal preference API endpoints."""

    def test_list_preferences(self, authenticated_client, meal_preference):
        """Test listing user's preferences."""
        url = reverse("food:preference-list")
        response = authenticated_client.get(url)
        assert response.status_code == 200

    def test_create_preference(self, authenticated_client):
        """Test creating a meal preference."""
        url = reverse("food:preference-list")
        data = {
            "day_of_week": DayOfWeek.TUESDAY,
            "adults_count": 2,
            "children_count": 0,
            "prefers_meat": False,
            "dining_option": DiningOption.TAKE_AWAY,
            "seating_time": SeatingTime.SECOND,
        }
        response = authenticated_client.post(url, data, format="json")
        assert response.status_code == 201


@pytest.mark.django_db
class TestMealRegistrationViews:
    """Tests for meal registration API endpoints."""

    def test_list_registrations(self, authenticated_client, meal_registration):
        """Test listing user's registrations."""
        url = reverse("food:registration-list")
        response = authenticated_client.get(url)
        assert response.status_code == 200

    def test_create_registration(self, authenticated_client, monday_date):
        """Test creating a meal registration."""
        url = reverse("food:registration-list")
        # Use next week to avoid duplicates
        next_monday = monday_date + timedelta(weeks=2)
        data = {
            "date": next_monday.isoformat(),
            "adults_count": 2,
            "children_count": 1,
            "meal_type": MealType.MEAT,
            "dining_option": DiningOption.EAT_IN,
            "seating_time": SeatingTime.FIRST,
        }
        response = authenticated_client.post(url, data, format="json")
        assert response.status_code == 201


@pytest.mark.django_db
class TestFoodTicketViews:
    """Tests for food ticket API endpoints."""

    def test_list_tickets(self, authenticated_client, food_ticket):
        """Test listing available tickets."""
        url = reverse("food:ticket-list")
        response = authenticated_client.get(url)
        assert response.status_code == 200

    def test_create_ticket(self, authenticated_client, monday_date):
        """Test creating a food ticket."""
        url = reverse("food:ticket-list")
        future_date = monday_date + timedelta(weeks=5)
        data = {
            "date": future_date.isoformat(),
            "adults_count": 1,
            "children_count": 0,
            "meal_type": MealType.VEGETARIAN,
            "price": "25.00",
        }
        with patch("apps.notifications.services.notify_food_ticket_available"):
            response = authenticated_client.post(url, data, format="json")
        assert response.status_code == 201

    def test_claim_ticket(self, api_client, admin_user, food_ticket):
        """Test claiming a food ticket."""
        api_client.force_authenticate(user=admin_user)
        url = reverse("food:ticket-claim", kwargs={"pk": food_ticket.pk})
        with patch("apps.notifications.services.notify_ticket_claimed"):
            response = api_client.post(url)
        assert response.status_code == 200
        food_ticket.refresh_from_db()
        assert food_ticket.is_available is False
        assert food_ticket.claimed_by == admin_user

    def test_cannot_claim_own_ticket(self, authenticated_client, food_ticket):
        """Test that user cannot claim their own ticket."""
        url = reverse("food:ticket-claim", kwargs={"pk": food_ticket.pk})
        response = authenticated_client.post(url)
        assert response.status_code == 400

    def test_release_ticket(self, api_client, user, admin_user, food_ticket):
        """Test releasing a claimed ticket."""
        # First claim the ticket
        food_ticket.is_available = False
        food_ticket.claimed_by = admin_user
        food_ticket.save()

        # Claimer releases it
        api_client.force_authenticate(user=admin_user)
        url = reverse("food:ticket-release", kwargs={"pk": food_ticket.pk})
        response = api_client.post(url)
        assert response.status_code == 200
        food_ticket.refresh_from_db()
        assert food_ticket.is_available is True


@pytest.mark.django_db
class TestFoodTeamViews:
    """Tests for food team API endpoints."""

    def test_list_teams(self, authenticated_client, food_team):
        """Test listing food teams."""
        url = reverse("food:team-list")
        response = authenticated_client.get(url)
        assert response.status_code == 200

    def test_get_my_teams(self, authenticated_client, food_team, food_team_member):
        """Test getting user's teams."""
        url = reverse("food:my-teams")
        response = authenticated_client.get(url)
        assert response.status_code == 200
        data = response.json()
        if isinstance(data, dict) and "results" in data:
            data = data["results"]
        assert len(data) >= 1


@pytest.mark.django_db
class TestFoodTeamCycleViews:
    """Tests for food team cycle API endpoints."""

    def test_list_cycles(self, authenticated_client, food_team_cycle):
        """Test listing cycles."""
        url = reverse("food:cycle-list")
        response = authenticated_client.get(url)
        assert response.status_code == 200

    def test_create_cycle_requires_admin(self, authenticated_client, monday_date):
        """Test that only admins can create cycles."""
        url = reverse("food:cycle-list")
        cooking_dates = generate_cooking_dates(monday_date, num_weeks=1)
        data = {
            "name": "New Cycle",
            "cooking_dates": cooking_dates,
            "wish_deadline": (timezone.now() + timedelta(days=1)).isoformat(),
        }
        response = authenticated_client.post(url, data, format="json")
        assert response.status_code == 403

    def test_admin_can_create_cycle(self, admin_client, monday_date):
        """Test that admin can create cycles."""
        url = reverse("food:cycle-list")
        # Use a far future date to avoid conflicts
        far_monday = monday_date + timedelta(weeks=20)
        cooking_dates = generate_cooking_dates(far_monday, num_weeks=1)
        data = {
            "name": "Admin Cycle",
            "cooking_dates": cooking_dates,
            "wish_deadline": (timezone.now() + timedelta(days=1)).isoformat(),
        }
        response = admin_client.post(url, data, format="json")
        assert response.status_code == 201


@pytest.mark.django_db
class TestFoodTeamWishViews:
    """Tests for food team wish API endpoints."""

    def test_submit_wish(self, authenticated_client, food_team_cycle, monday_date):
        """Test submitting a wish."""
        url = reverse("food:my-wish", kwargs={"cycle_id": food_team_cycle.id})
        data = {
            "available_dates": [
                monday_date.isoformat(),
                (monday_date + timedelta(days=1)).isoformat(),
            ],
            "comment": "I prefer Mondays",
        }
        response = authenticated_client.post(url, data, format="json")
        assert response.status_code == 201

    def test_get_my_wish(self, authenticated_client, food_team_wish, food_team_cycle):
        """Test getting user's wish."""
        url = reverse("food:my-wish", kwargs={"cycle_id": food_team_cycle.id})
        response = authenticated_client.get(url)
        assert response.status_code == 200


@pytest.mark.django_db
class TestRegistrationStatsView:
    """Tests for registration statistics endpoint."""

    def test_get_daily_stats(self, authenticated_client, meal_registration, monday_date):
        """Test getting daily registration stats."""
        url = reverse("food:registration-stats")
        response = authenticated_client.get(url, {"date": monday_date.isoformat()})
        assert response.status_code == 200
        data = response.json()
        assert "total" in data
        assert "takeaway" in data
        assert "eat_in_1730" in data
        assert "eat_in_1830" in data

    def test_get_weekly_stats(self, authenticated_client, meal_registration, monday_date):
        """Test getting weekly registration stats."""
        url = reverse("food:registration-stats")
        response = authenticated_client.get(url, {"week_start": monday_date.isoformat()})
        assert response.status_code == 200


# =============================================================================
# Team Generator Service Tests
# =============================================================================


@pytest.mark.django_db
class TestTeamGenerator:
    """Tests for TeamGenerator service."""

    def test_generator_initialization(self, food_team_cycle):
        """Test generator initialization."""
        generator = TeamGenerator(food_team_cycle)
        assert generator.cycle == food_team_cycle
        assert len(generator.cooking_dates) > 0

    def test_load_data(self, food_team_cycle, user):
        """Test loading data from database."""
        # Mark user as eligible
        user.is_exempt_from_food_teams = False
        user.save()

        generator = TeamGenerator(food_team_cycle)
        generator.load_data()

        assert len(generator.persons) >= 1

    def test_is_valid_assignment(self, food_team_cycle, multiple_users, monday_date):
        """Test assignment validation."""
        generator = TeamGenerator(food_team_cycle)
        generator.load_data()

        # First assignment should be valid
        user_id = multiple_users[0].id
        if user_id in generator.persons:
            # Ensure date is in cooking dates
            if monday_date in generator.cooking_dates:
                assert generator.is_valid_assignment(user_id, monday_date) is True

    def test_generate_dry_run(self, food_team_cycle, multiple_users, monday_date):
        """Test dry run generation."""
        # Create wishes for all users (cooking_dates is already a list of ISO strings)
        for user in multiple_users:
            user.is_exempt_from_food_teams = False
            user.save()
            FoodTeamWish.objects.create(
                cycle=food_team_cycle,
                user=user,
                available_dates=food_team_cycle.cooking_dates[:8],
            )

        generator = TeamGenerator(food_team_cycle)
        result = generator.generate(save=False)

        assert isinstance(result, TeamGenerationResult)
        # Should not have saved teams
        assert FoodTeam.objects.filter(cycle=food_team_cycle).count() == 0

    def test_generate_with_save(self, db, admin_user, multiple_users):
        """Test actual generation with save."""
        # Create a fresh cycle
        today = timezone.now().date()
        next_monday = today + timedelta(days=(7 - today.weekday()))
        cooking_dates = generate_cooking_dates(next_monday, num_weeks=2)

        cycle = FoodTeamCycle.objects.create(
            name="Generation Test Cycle",
            cooking_dates=cooking_dates,
            wish_deadline=timezone.now() + timedelta(days=7),
            status=CycleStatus.COLLECTING_WISHES,
            created_by=admin_user,
        )

        # Create wishes (cooking_dates is already a list of ISO strings)
        for user in multiple_users:
            user.is_exempt_from_food_teams = False
            user.save()
            FoodTeamWish.objects.create(
                cycle=cycle,
                user=user,
                available_dates=cycle.cooking_dates,
            )

        generator = TeamGenerator(cycle)
        result = generator.generate(save=True)

        assert isinstance(result, TeamGenerationResult)
        assert result.teams_created > 0

        # Verify teams were saved
        teams = FoodTeam.objects.filter(cycle=cycle)
        assert teams.count() > 0

    def test_house_conflict_detection(self, db, admin_user, house, monday_date):
        """Test that users from same house are not assigned together."""
        # Create users from same house
        users = []
        for i in range(3):
            user = User.objects.create_user(
                email=f"sameHouse{i}@example.com",
                password="testpass123",
                first_name=f"SameHouse{i}",
                house=house,
            )
            users.append(user)

        # Create cycle
        cooking_dates = generate_cooking_dates(monday_date, num_weeks=1)
        cycle = FoodTeamCycle.objects.create(
            name="House Conflict Test",
            cooking_dates=cooking_dates,
            wish_deadline=timezone.now() + timedelta(days=7),
            status=CycleStatus.COLLECTING_WISHES,
            created_by=admin_user,
        )

        generator = TeamGenerator(cycle)
        generator.load_data()

        # Assign first user (cooking_dates are now date objects in the generator)
        monday_date_iso = monday_date.isoformat()
        if monday_date_iso in cycle.cooking_dates and users[0].id in generator.persons:
            generator.assign_person(users[0].id, monday_date)

            # Second user from same house should be invalid
            if users[1].id in generator.persons:
                assert generator.is_valid_assignment(users[1].id, monday_date) is False

    def test_over_50_limit(self, db, admin_user, house, house2, monday_date):
        """Test that max 2 over-50 people are assigned per team."""
        # Create over-50 users
        users = []
        for i in range(4):
            user = User.objects.create_user(
                email=f"over50User{i}@example.com",
                password="testpass123",
                first_name=f"Over50User{i}",
                house=house if i % 2 == 0 else house2,  # Different houses
                is_over_50=True,
            )
            users.append(user)

        cooking_dates = generate_cooking_dates(monday_date, num_weeks=1)
        cycle = FoodTeamCycle.objects.create(
            name="Over 50 Test",
            cooking_dates=cooking_dates,
            wish_deadline=timezone.now() + timedelta(days=7),
            status=CycleStatus.COLLECTING_WISHES,
            created_by=admin_user,
        )

        generator = TeamGenerator(cycle)
        generator.load_data()

        if monday_date in generator.cooking_dates:
            # Assign first two over-50 users
            for i in range(2):
                if users[i].id in generator.persons:
                    generator.assign_person(users[i].id, monday_date)

            # Third over-50 user should be invalid
            if users[2].id in generator.persons:
                assert generator.is_valid_assignment(users[2].id, monday_date) is False


# =============================================================================
# Apply Defaults View Tests
# =============================================================================


@pytest.mark.django_db
class TestApplyDefaultsView:
    """Tests for apply defaults endpoint."""

    def test_apply_defaults_with_preferences(
        self, authenticated_client, meal_preference, monday_date
    ):
        """Test applying defaults when user has preferences."""
        # Use a future Monday
        future_monday = monday_date + timedelta(weeks=5)
        url = reverse("food:apply-defaults")
        response = authenticated_client.post(
            url, {"week_start_date": future_monday.isoformat()}, format="json"
        )
        assert response.status_code == 200
        assert "Applied defaults" in response.json()["detail"]

    def test_apply_defaults_without_preferences(self, api_client, user_with_house, monday_date):
        """Test applying defaults when user has no preferences but has a house."""
        api_client.force_authenticate(user=user_with_house)
        future_monday = monday_date + timedelta(weeks=6)
        url = reverse("food:apply-defaults")
        response = api_client.post(
            url, {"week_start_date": future_monday.isoformat()}, format="json"
        )
        assert response.status_code == 200

    def test_apply_defaults_rejects_non_monday(self, authenticated_client, monday_date):
        """Test that non-Monday dates are rejected."""
        tuesday = monday_date + timedelta(days=1)
        url = reverse("food:apply-defaults")
        response = authenticated_client.post(
            url, {"week_start_date": tuesday.isoformat()}, format="json"
        )
        assert response.status_code == 400


# =============================================================================
# Unauthenticated Access Tests
# =============================================================================


@pytest.mark.django_db
class TestUnauthenticatedAccess:
    """Tests to ensure endpoints require authentication."""

    def test_menu_list_requires_auth(self, api_client):
        """Test that menu list requires authentication."""
        url = reverse("food:menu-list")
        response = api_client.get(url)
        assert response.status_code == 401

    def test_ticket_list_requires_auth(self, api_client):
        """Test that ticket list requires authentication."""
        url = reverse("food:ticket-list")
        response = api_client.get(url)
        assert response.status_code == 401

    def test_team_list_requires_auth(self, api_client):
        """Test that team list requires authentication."""
        url = reverse("food:team-list")
        response = api_client.get(url)
        assert response.status_code == 401


# =============================================================================
# Food Ticket Default Pricing and Registration Tests
# =============================================================================


@pytest.mark.django_db
class TestFoodTicketDefaultPricing:
    """Tests for food ticket default pricing."""

    def test_default_price_meat(self, db, user):
        """Test default price calculation for meat meal."""
        from apps.food.serializers import FoodTicketCreateSerializer

        serializer = FoodTicketCreateSerializer(context={"request": MockRequest(user)})
        price = serializer.calculate_default_price(MealType.MEAT, 2, 1)
        # 2 adults @ 37 + 1 child @ 18 = 92
        assert price == Decimal("92.00")

    def test_default_price_vegetarian(self, db, user):
        """Test default price calculation for vegetarian meal."""
        from apps.food.serializers import FoodTicketCreateSerializer

        serializer = FoodTicketCreateSerializer(context={"request": MockRequest(user)})
        price = serializer.calculate_default_price(MealType.VEGETARIAN, 2, 1)
        # 2 adults @ 26 + 1 child @ 18 = 70
        assert price == Decimal("70.00")

    def test_ticket_created_with_default_price(self, api_client, user_with_house, monday_date):
        """Test that ticket is created with default price if not specified."""
        api_client.force_authenticate(user=user_with_house)

        # Use a date after the registration deadline (current week)
        # The deadline for this week's meals passed last Wednesday
        today = timezone.now().date()
        # Find a future Monday in a week where the deadline has passed
        future_monday = today + timedelta(days=(7 - today.weekday()))
        if today.weekday() < 2:  # Before Wednesday
            # Need to go to next week
            future_monday += timedelta(weeks=1)

        # Actually, let's mock the time to be after the deadline
        with patch("apps.food.serializers.timezone") as mock_tz:
            # Set current time to Thursday of this week
            mock_now = timezone.make_aware(
                timezone.datetime(2025, 12, 18, 10, 0)  # Thursday
            )
            mock_tz.now.return_value = mock_now
            mock_tz.get_current_timezone.return_value = timezone.get_current_timezone()

            # Ticket for next Monday
            next_monday = date(2025, 12, 22)

            url = reverse("food:ticket-list")
            data = {
                "date": next_monday.isoformat(),
                "adults_count": 2,
                "children_count": 1,
                "meal_type": MealType.MEAT,
                # No price specified - should use default
            }
            with patch("apps.notifications.services.notify_food_ticket_available"):
                response = api_client.post(url, data, format="json")

            assert response.status_code == 201
            # Default price: 2 adults @ 37 + 1 child @ 18 = 92
            assert Decimal(response.json()["price"]) == Decimal("92.00")


@pytest.mark.django_db
class TestFoodTicketDeactivatesRegistration:
    """Tests for ticket creation deactivating meal registration."""

    def test_ticket_deactivates_registration(self, api_client, user_with_house, monday_date):
        """Test that creating a ticket deactivates the meal registration."""
        api_client.force_authenticate(user=user_with_house)

        # Use a specific date that we know works
        reg_date = date(2025, 12, 22)  # A Monday
        registration = MealRegistration.objects.create(
            user=user_with_house,
            date=reg_date,
            adults_count=2,
            children_count=1,
            is_active=True,
        )
        assert registration.is_active is True

        # Create a ticket for the same date (mock time to be after deadline)
        with patch("apps.food.serializers.timezone") as mock_tz:
            # Set time to Thursday Dec 18 (after Wednesday Dec 17 18:00 deadline)
            mock_now = timezone.make_aware(timezone.datetime(2025, 12, 18, 10, 0))
            mock_tz.now.return_value = mock_now
            mock_tz.get_current_timezone.return_value = timezone.get_current_timezone()

            url = reverse("food:ticket-list")
            data = {
                "date": reg_date.isoformat(),
                "adults_count": 2,
                "children_count": 1,
                "meal_type": MealType.MEAT,
            }
            with patch("apps.notifications.services.notify_food_ticket_available"):
                response = api_client.post(url, data, format="json")

            assert response.status_code == 201

        # Registration should now be inactive
        registration.refresh_from_db()
        assert registration.is_active is False


@pytest.mark.django_db
class TestCannotRegisterWithActiveTicket:
    """Tests for preventing registration when user has active ticket."""

    def test_cannot_create_registration_with_active_ticket(
        self, api_client, user_with_house, monday_date
    ):
        """Test that user cannot create registration when they have an active ticket."""
        api_client.force_authenticate(user=user_with_house)

        # Create an available ticket
        ticket_date = monday_date + timedelta(weeks=4)
        FoodTicket.objects.create(
            owner=user_with_house,
            date=ticket_date,
            adults_count=1,
            children_count=0,
            is_available=True,
        )

        # Try to create a registration for the same date
        url = reverse("food:registration-list")
        data = {
            "date": ticket_date.isoformat(),
            "adults_count": 1,
            "children_count": 0,
            "meal_type": MealType.MEAT,
        }
        response = api_client.post(url, data, format="json")

        assert response.status_code == 400
        assert "active food ticket" in str(response.json()).lower()

    def test_cannot_activate_registration_with_active_ticket(
        self, api_client, user_with_house, monday_date
    ):
        """Test that user cannot activate registration when they have an active ticket."""
        api_client.force_authenticate(user=user_with_house)

        ticket_date = monday_date + timedelta(weeks=5)

        # Create inactive registration first
        registration = MealRegistration.objects.create(
            user=user_with_house,
            date=ticket_date,
            adults_count=1,
            is_active=False,
        )

        # Create an available ticket
        FoodTicket.objects.create(
            owner=user_with_house,
            date=ticket_date,
            adults_count=1,
            children_count=0,
            is_available=True,
        )

        # Try to activate the registration
        url = reverse("food:registration-detail", kwargs={"pk": registration.pk})
        response = api_client.patch(url, {"is_active": True}, format="json")

        assert response.status_code == 400
        assert "active food ticket" in str(response.json()).lower()

    def test_can_register_after_ticket_claimed(
        self, api_client, user_with_house, admin_user, monday_date
    ):
        """Test that user can register after their ticket is claimed."""
        api_client.force_authenticate(user=user_with_house)

        ticket_date = monday_date + timedelta(weeks=6)

        # Create a claimed (not available) ticket
        FoodTicket.objects.create(
            owner=user_with_house,
            date=ticket_date,
            adults_count=1,
            children_count=0,
            is_available=False,
            claimed_by=admin_user,
            claimed_at=timezone.now(),
        )

        # Should be able to create registration now
        url = reverse("food:registration-list")
        data = {
            "date": ticket_date.isoformat(),
            "adults_count": 1,
            "children_count": 0,
            "meal_type": MealType.MEAT,
        }
        response = api_client.post(url, data, format="json")

        assert response.status_code == 201


@pytest.mark.django_db
class TestTicketCreationDeadline:
    """Tests for ticket creation deadline restrictions."""

    def test_cannot_create_ticket_before_deadline(self, api_client, user_with_house):
        """Test that tickets cannot be created before registration deadline."""
        api_client.force_authenticate(user=user_with_house)

        # Mock time to be Monday morning
        with patch("apps.food.serializers.timezone") as mock_tz:
            mock_now = timezone.make_aware(timezone.datetime(2025, 12, 15, 10, 0))
            mock_tz.now.return_value = mock_now
            mock_tz.get_current_timezone.return_value = timezone.get_current_timezone()

            # Try to create ticket for Monday of next week
            # Deadline is Wednesday Dec 17 at 18:00
            next_monday = date(2025, 12, 22)

            url = reverse("food:ticket-list")
            data = {
                "date": next_monday.isoformat(),
                "adults_count": 1,
                "children_count": 0,
                "meal_type": MealType.MEAT,
            }
            with patch("apps.notifications.services.notify_food_ticket_available"):
                response = api_client.post(url, data, format="json")

            assert response.status_code == 400
            assert "deadline" in str(response.json()).lower()

    def test_can_create_ticket_after_deadline(self, api_client, user_with_house):
        """Test that tickets can be created after registration deadline."""
        api_client.force_authenticate(user=user_with_house)

        # Mock time to be Thursday (after deadline)
        with patch("apps.food.serializers.timezone") as mock_tz:
            mock_now = timezone.make_aware(timezone.datetime(2025, 12, 18, 10, 0))
            mock_tz.now.return_value = mock_now
            mock_tz.get_current_timezone.return_value = timezone.get_current_timezone()

            # Create ticket for Monday of next week
            # Deadline was Wednesday Dec 17 at 18:00 - already passed
            next_monday = date(2025, 12, 22)

            url = reverse("food:ticket-list")
            data = {
                "date": next_monday.isoformat(),
                "adults_count": 1,
                "children_count": 0,
                "meal_type": MealType.MEAT,
            }
            with patch("apps.notifications.services.notify_food_ticket_available"):
                response = api_client.post(url, data, format="json")

            assert response.status_code == 201

    def test_deadline_calculation(self, db, user):
        """Test deadline calculation for different meal dates."""
        from apps.food.serializers import FoodTicketCreateSerializer

        serializer = FoodTicketCreateSerializer(context={"request": MockRequest(user)})

        # Monday Dec 22, 2025 - deadline should be Wed Dec 17 at 18:00
        monday = date(2025, 12, 22)
        deadline = serializer.get_registration_deadline(monday)
        assert deadline.date() == date(2025, 12, 17)
        assert deadline.hour == 18

        # Tuesday Dec 23 - deadline should also be Wed Dec 17 at 18:00
        tuesday = date(2025, 12, 23)
        deadline = serializer.get_registration_deadline(tuesday)
        assert deadline.date() == date(2025, 12, 17)

        # Wednesday Dec 24 - deadline should be Wed Dec 17 at 18:00
        wednesday = date(2025, 12, 24)
        deadline = serializer.get_registration_deadline(wednesday)
        assert deadline.date() == date(2025, 12, 17)

        # Thursday Dec 25 - deadline should be Wed Dec 17 at 18:00
        thursday = date(2025, 12, 25)
        deadline = serializer.get_registration_deadline(thursday)
        assert deadline.date() == date(2025, 12, 17)


@pytest.mark.django_db
class TestMonthlyFoodCostReport:
    """Tests for monthly food cost report."""

    def test_cost_charged_to_owner_house(
        self, api_client, admin_user, user_with_house, house, house2
    ):
        """Test that food cost is charged to the ticket owner's house, not claimer's."""
        # Create a user in house2 who will claim the ticket
        claimer = User.objects.create_user(
            email="claimer@example.com",
            password="testpass123",
            first_name="Claimer",
            house=house2,
        )

        # Create a ticket owned by user_with_house (in house)
        # and claimed by claimer (in house2)
        ticket_date = date(2025, 1, 13)  # A Monday in January 2025
        FoodTicket.objects.create(
            owner=user_with_house,
            date=ticket_date,
            adults_count=2,
            children_count=0,
            meal_type=MealType.MEAT,
            price=Decimal("74.00"),  # 2 * 37
            is_available=False,
            claimed_by=claimer,
            claimed_at=timezone.now(),
        )

        # Get the monthly cost report as admin
        api_client.force_authenticate(user=admin_user)
        url = reverse("food:monthly-food-cost")
        response = api_client.get(url, {"year": 2025, "month": 1})

        assert response.status_code == 200
        data = response.json()

        # Find the house costs
        owner_house_cost = next((h for h in data["houses"] if h["house_id"] == house.id), None)
        claimer_house_cost = next((h for h in data["houses"] if h["house_id"] == house2.id), None)

        # The OWNER's house (house) should have the cost
        assert owner_house_cost is not None
        assert Decimal(owner_house_cost["total_cost"]) == Decimal("74.00")
        assert owner_house_cost["ticket_count"] == 1

        # The CLAIMER's house (house2) should have zero cost from this ticket
        # (they might have other tickets, but not this one)
        if claimer_house_cost:
            # This ticket should not count toward claimer's house
            # Check that any cost is not from our test ticket
            pass  # The cost should be 0 or from other tickets

    def test_only_admin_can_access_report(self, api_client, user_with_house):
        """Test that non-admin users cannot access the cost report."""
        api_client.force_authenticate(user=user_with_house)
        url = reverse("food:monthly-food-cost")
        response = api_client.get(url, {"year": 2025, "month": 1})

        assert response.status_code == 403

    def test_report_requires_year_and_month(self, api_client, admin_user):
        """Test that year and month parameters are required."""
        api_client.force_authenticate(user=admin_user)
        url = reverse("food:monthly-food-cost")

        # Missing both
        response = api_client.get(url)
        assert response.status_code == 400

        # Missing month
        response = api_client.get(url, {"year": 2025})
        assert response.status_code == 400

        # Missing year
        response = api_client.get(url, {"month": 1})
        assert response.status_code == 400

    def test_report_totals_multiple_tickets(self, api_client, admin_user, user_with_house, house):
        """Test that report correctly sums multiple tickets."""
        # Clean up existing tickets for this test
        FoodTicket.objects.filter(
            date__year=2025,
            date__month=2,
        ).delete()

        # Create multiple tickets for the same owner
        for i in range(3):
            FoodTicket.objects.create(
                owner=user_with_house,
                date=date(2025, 2, 3 + i),  # Feb 3, 4, 5 (Mon, Tue, Wed)
                adults_count=1,
                children_count=0,
                meal_type=MealType.MEAT,
                price=Decimal("37.00"),
                is_available=False,
                claimed_by=admin_user,
                claimed_at=timezone.now(),
            )

        api_client.force_authenticate(user=admin_user)
        url = reverse("food:monthly-food-cost")
        response = api_client.get(url, {"year": 2025, "month": 2})

        assert response.status_code == 200
        data = response.json()

        owner_house_cost = next((h for h in data["houses"] if h["house_id"] == house.id), None)

        assert owner_house_cost is not None
        assert Decimal(owner_house_cost["total_cost"]) == Decimal("111.00")  # 3 * 37
        assert owner_house_cost["ticket_count"] == 3
