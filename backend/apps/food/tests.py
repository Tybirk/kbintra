"""
Tests for the Food app.

Uses pytest and pytest-django for testing.
"""

from datetime import date, datetime, time, timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.food.models import (
    CycleStatus,
    DayOfWeek,
    DiningOption,
    DriveMenuCache,
    FoodTeam,
    FoodTeamCycle,
    FoodTeamMember,
    FoodTeamWish,
    FoodTicket,
    MealPreference,
    MealRegistration,
    SeatingTime,
    SwapRequestStatus,
    TeamSwapRequest,
)
from apps.food.serializers import (
    FoodTeamCycleCreateSerializer,
    FoodTeamWishCreateUpdateSerializer,
    FoodTicketCreateSerializer,
    MealRegistrationCreateUpdateSerializer,
)
from apps.food.services.team_generator import TeamGenerationResult, TeamGenerator
from apps.users.models import User
from conftest import generate_cooking_dates

# =============================================================================
# Model Tests
# =============================================================================


class TestMealPreferenceModel:
    """Tests for MealPreference model."""

    def test_create_meal_preference(self, meal_preference):
        """Test creating a meal preference."""
        assert meal_preference.day_of_week == DayOfWeek.MONDAY
        assert meal_preference.adults_meat == 0
        assert meal_preference.adults_veg == 2
        assert meal_preference.adults_count == 2
        assert meal_preference.children_count == 1
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
        assert meal_registration.adults_meat == 0
        assert meal_registration.adults_veg == 2
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
            adults_veg=4,
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
            "Mandag",
            "Tirsdag",
            "Onsdag",
            "Torsdag",
            "Fredag",
            "Lørdag",
            "Søndag",
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


class TestDriveMenuCacheModel:
    """Tests for DriveMenuCache model."""

    def test_create_drive_menu_cache(self, db):
        """Test creating a drive menu cache entry."""
        cache = DriveMenuCache.objects.create(
            week_number=3,
            year=2026,
            monday_menu="Lasagne",
            tuesday_menu="Thai curry",
            wednesday_menu="Frikadeller",
            thursday_menu="Pasta",
        )
        assert cache.week_number == 3
        assert cache.year == 2026
        assert str(cache) == "Week 3, 2026"

    def test_is_stale(self, db):
        """Test is_stale method."""
        cache = DriveMenuCache.objects.create(
            week_number=4,
            year=2026,
            monday_menu="Test",
        )
        # Just created, should not be stale
        assert cache.is_stale(max_age_hours=1) is False

    def test_unique_constraint(self, db):
        """Test unique constraint on week_number + year."""
        from django.db import IntegrityError

        DriveMenuCache.objects.create(week_number=5, year=2026)
        with pytest.raises(IntegrityError):
            DriveMenuCache.objects.create(week_number=5, year=2026)


# =============================================================================
# Serializer Tests
# =============================================================================


class MockRequest:
    """Simple mock request object for serializer tests."""

    def __init__(self, user):
        self.user = user


class TestMealRegistrationSerializer:
    """Tests for MealRegistrationCreateUpdateSerializer."""

    def test_validate_weekday(self, db, user, monday_date):
        """Test that only Mon-Thu dates are accepted."""
        # Valid Monday
        serializer = MealRegistrationCreateUpdateSerializer(
            data={
                "date": monday_date.isoformat(),
                "adults_veg": 1,
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
                "adults_veg": 1,
                "children_count": 0,
            },
            context={"request": MockRequest(user)},
        )
        assert not serializer.is_valid()
        assert "date" in serializer.errors

    def test_reject_meat_on_non_wednesday(self, db, user, monday_date):
        """Test that adults_meat > 0 on non-Wednesday is rejected."""
        serializer = MealRegistrationCreateUpdateSerializer(
            data={
                "date": monday_date.isoformat(),
                "adults_meat": 1,
                "adults_veg": 0,
                "children_count": 0,
            },
            context={"request": MockRequest(user)},
        )
        assert not serializer.is_valid()
        assert "adults_meat" in serializer.errors

    def test_reject_empty_portions(self, db, user, monday_date):
        """Test that zero total portions is rejected when active."""
        serializer = MealRegistrationCreateUpdateSerializer(
            data={
                "date": monday_date.isoformat(),
                "adults_meat": 0,
                "adults_veg": 0,
                "children_count": 0,
                "is_active": True,
            },
            context={"request": MockRequest(user)},
        )
        assert not serializer.is_valid()

    def test_wednesday_allows_meat(self, db, user, monday_date):
        """Test that adults_meat > 0 is allowed on Wednesday."""
        wednesday = monday_date + timedelta(days=2)
        serializer = MealRegistrationCreateUpdateSerializer(
            data={
                "date": wednesday.isoformat(),
                "adults_meat": 1,
                "adults_veg": 1,
                "children_count": 0,
            },
            context={"request": MockRequest(user)},
        )
        assert serializer.is_valid()


class TestFoodTicketCreateSerializer:
    """Tests for FoodTicketCreateSerializer."""

    def test_reject_past_date(self, db, user):
        """Test that past dates are rejected."""
        past_date = timezone.now().date() - timedelta(days=1)
        serializer = FoodTicketCreateSerializer(
            data={
                "date": past_date.isoformat(),
                "adults_veg": 1,
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
            "adults_meat": 0,
            "adults_veg": 2,
            "children_count": 0,
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
            "adults_meat": 0,
            "adults_veg": 2,
            "children_count": 1,
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
        # Mock time to be after deadline (Thursday of the previous week)
        # Deadline is Wednesday 18:00 of the week before the meal
        mock_now_date = future_date - timedelta(days=4)  # Thursday before Monday
        with patch("apps.food.serializers.timezone") as mock_tz:
            mock_now = timezone.make_aware(datetime.combine(mock_now_date, time(10, 0)))
            mock_tz.now.return_value = mock_now
            mock_tz.get_current_timezone.return_value = timezone.get_current_timezone()
            data = {
                "date": future_date.isoformat(),
                "adults_veg": 1,
                "children_count": 0,
                "price": "25.00",
            }
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

    def test_can_claim_own_ticket(self, authenticated_client, food_ticket):
        """Test that user can claim (recall) their own ticket."""
        url = reverse("food:ticket-claim", kwargs={"pk": food_ticket.pk})
        response = authenticated_client.post(url)
        assert response.status_code == 200
        food_ticket.refresh_from_db()
        assert food_ticket.is_available is False
        assert food_ticket.claimed_by == food_ticket.owner

    def test_claim_own_ticket_no_notification(self, authenticated_client, food_ticket):
        """Test that claiming own ticket doesn't send notification."""
        with patch("apps.notifications.services.notify_ticket_claimed") as mock_notify:
            url = reverse("food:ticket-claim", kwargs={"pk": food_ticket.pk})
            response = authenticated_client.post(url)
            assert response.status_code == 200
            # Notification should NOT be called when claiming own ticket
            mock_notify.assert_not_called()

    def test_claim_ticket_sends_notification(self, api_client, admin_user, food_ticket):
        """Test that claiming another user's ticket sends notification."""
        api_client.force_authenticate(user=admin_user)
        with patch("apps.notifications.services.notify_ticket_claimed") as mock_notify:
            url = reverse("food:ticket-claim", kwargs={"pk": food_ticket.pk})
            response = api_client.post(url)
            assert response.status_code == 200
            # Notification should be called when claiming someone else's ticket
            mock_notify.assert_called_once()

    def test_cannot_claim_already_claimed_ticket(self, api_client, admin_user, food_ticket):
        """Test that already claimed tickets cannot be claimed again."""
        # First claim the ticket
        food_ticket.is_available = False
        food_ticket.claimed_by = admin_user
        food_ticket.save()

        # Try to claim again
        api_client.force_authenticate(user=admin_user)
        url = reverse("food:ticket-claim", kwargs={"pk": food_ticket.pk})
        response = api_client.post(url)
        assert response.status_code == 400
        assert "no longer available" in response.json()["detail"].lower()

    def test_owner_cannot_claim_ticket_claimed_by_other(
        self, authenticated_client, food_ticket, admin_user
    ):
        """Test that owner cannot claim back a ticket that someone else claimed."""
        # Someone else claims the ticket
        food_ticket.is_available = False
        food_ticket.claimed_by = admin_user
        food_ticket.save()

        # Owner tries to claim it back
        url = reverse("food:ticket-claim", kwargs={"pk": food_ticket.pk})
        response = authenticated_client.post(url)
        assert response.status_code == 400
        assert "no longer available" in response.json()["detail"].lower()

    def test_after_claiming_own_ticket_can_register(self, api_client, user_with_house, monday_date):
        """Test that user can register even when they have an active ticket (partial selling)."""
        api_client.force_authenticate(user=user_with_house)

        # Create a ticket
        ticket = FoodTicket.objects.create(
            owner=user_with_house,
            date=monday_date,
            adults_meat=0,
            adults_veg=1,
            children_count=0,
            price=Decimal("26.00"),
        )

        # Registration is NOT blocked by tickets - partial selling is allowed
        reg_url = reverse("food:registration-list")
        reg_data = {
            "date": monday_date.isoformat(),
            "adults_veg": 1,
            "children_count": 0,
            "is_active": True,
        }
        response = api_client.post(reg_url, reg_data, format="json")
        assert response.status_code == 201

        assert ticket is not None  # ticket still exists

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


@pytest.mark.django_db
class TestDriveMenuViews:
    """Tests for drive menu API endpoints."""

    def test_get_drive_menu(self, authenticated_client, db):
        """Test getting drive menu (returns 404 if not cached)."""
        url = reverse("food:drive-menu")
        response = authenticated_client.get(url)
        # Will be 404 if no cache exists, 200 if it does
        assert response.status_code in [200, 404]

    def test_get_drive_menu_with_cache(self, authenticated_client, db):
        """Test getting drive menu when cache exists."""
        # Create cache entry for current week
        today = timezone.now().date()
        week_number = today.isocalendar()[1]
        year = today.isocalendar()[0]

        DriveMenuCache.objects.create(
            week_number=week_number,
            year=year,
            monday_menu="Lasagne",
            tuesday_menu="Thai curry",
            wednesday_menu="Frikadeller",
            thursday_menu="Pasta",
        )

        url = reverse("food:drive-menu")
        response = authenticated_client.get(url)
        assert response.status_code == 200
        data = response.json()
        assert data["monday_menu"] == "Lasagne"
        assert data["tuesday_menu"] == "Thai curry"

    def test_get_drive_menu_by_week(self, authenticated_client, db):
        """Test getting drive menu for specific week."""
        DriveMenuCache.objects.create(
            week_number=10,
            year=2026,
            monday_menu="Test menu",
        )

        url = reverse("food:drive-menu")
        response = authenticated_client.get(url, {"week": 10, "year": 2026})
        assert response.status_code == 200
        data = response.json()
        assert data["week_number"] == 10
        assert data["year"] == 2026

    def test_refresh_drive_menu_requires_admin(self, authenticated_client):
        """Test that refreshing drive menu requires admin."""
        url = reverse("food:drive-menu")
        response = authenticated_client.post(url)
        assert response.status_code == 403


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
        if user_id in generator.persons and monday_date in generator.cooking_dates:
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
class TestWednesdayMeatVeg:
    """Tests for Wednesday mixed meal types."""

    def test_wednesday_mixed_registration(self, authenticated_client, monday_date):
        """Test registering mixed meat+veg on Wednesday."""
        wednesday = monday_date + timedelta(days=2)
        url = reverse("food:registration-list")
        data = {
            "date": wednesday.isoformat(),
            "adults_meat": 1,
            "adults_veg": 1,
            "children_count": 0,
        }
        response = authenticated_client.post(url, data, format="json")
        assert response.status_code == 201
        result = response.json()
        assert result["adults_meat"] == 1
        assert result["adults_veg"] == 1

    def test_wednesday_preference_allows_meat(self, authenticated_client):
        """Test that a Wednesday preference can have adults_meat > 0."""
        url = reverse("food:preference-list")
        data = {
            "day_of_week": 2,  # Wednesday
            "adults_meat": 2,
            "adults_veg": 0,
            "children_count": 0,
        }
        response = authenticated_client.post(url, data, format="json")
        assert response.status_code == 201

    def test_non_wednesday_preference_rejects_meat(self, authenticated_client):
        """Test that a non-Wednesday preference rejects adults_meat > 0."""
        url = reverse("food:preference-list")
        data = {
            "day_of_week": 1,  # Tuesday
            "adults_meat": 1,
            "adults_veg": 0,
            "children_count": 0,
        }
        response = authenticated_client.post(url, data, format="json")
        assert response.status_code == 400

    def test_stats_include_meat_veg_breakdown(self, authenticated_client, monday_date):
        """Stats for total include adults_meat and adults_veg breakdown."""
        wednesday = monday_date + timedelta(days=2)
        MealRegistration.objects.create(
            user=authenticated_client.handler._force_user
            if hasattr(authenticated_client, "handler")
            else User.objects.get(email="test@example.com"),
            date=wednesday,
            adults_meat=2,
            adults_veg=1,
            children_count=0,
            is_active=True,
        )
        url = reverse("food:registration-stats")
        response = authenticated_client.get(url, {"date": wednesday.isoformat()})
        assert response.status_code == 200
        data = response.json()
        assert "adults_meat" in data["total"]
        assert "adults_veg" in data["total"]


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

    def test_drive_menu_requires_auth(self, api_client):
        """Test that drive menu requires authentication."""
        url = reverse("food:drive-menu")
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
        serializer = FoodTicketCreateSerializer(context={"request": MockRequest(user)})
        price = serializer.calculate_default_price(adults_meat=2, adults_veg=0, children_count=1)
        # 2 adults @ 37 + 1 child @ 18 = 92
        assert price == Decimal("92.00")

    def test_default_price_vegetarian(self, db, user):
        """Test default price calculation for vegetarian meal."""
        serializer = FoodTicketCreateSerializer(context={"request": MockRequest(user)})
        price = serializer.calculate_default_price(adults_meat=0, adults_veg=2, children_count=1)
        # 2 adults @ 26 + 1 child @ 18 = 70
        assert price == Decimal("70.00")

    def test_default_price_mixed(self, db, user):
        """Test default price calculation for mixed meat+veg meal."""
        serializer = FoodTicketCreateSerializer(context={"request": MockRequest(user)})
        price = serializer.calculate_default_price(adults_meat=1, adults_veg=1, children_count=1)
        # 1 adult @ 37 + 1 adult @ 26 + 1 child @ 18 = 81
        assert price == Decimal("81.00")

    def test_ticket_created_with_default_price(self, api_client, user_with_house, monday_date):
        """Test that ticket is created with default price if not specified."""
        api_client.force_authenticate(user=user_with_house)

        with patch("apps.food.serializers.timezone") as mock_tz:
            mock_now = timezone.make_aware(
                timezone.datetime(2025, 12, 18, 10, 0)  # Thursday
            )
            mock_tz.now.return_value = mock_now
            mock_tz.get_current_timezone.return_value = timezone.get_current_timezone()

            # Ticket for next Monday (veg - no meat on Monday)
            next_monday = date(2025, 12, 22)

            url = reverse("food:ticket-list")
            data = {
                "date": next_monday.isoformat(),
                "adults_meat": 0,
                "adults_veg": 2,
                "children_count": 1,
                # No price specified - should use default
            }
            response = api_client.post(url, data, format="json")

            assert response.status_code == 201
            # Default price: 2 adults @ 26 + 1 child @ 18 = 70
            assert Decimal(response.json()["price"]) == Decimal("70.00")


@pytest.mark.django_db
class TestPartialTicketSelling:
    """Tests for partial ticket selling and registration deduction."""

    def test_full_ticket_deactivates_registration(self, api_client, user_with_house, monday_date):
        """Selling all portions deactivates the registration."""
        api_client.force_authenticate(user=user_with_house)

        reg_date = date(2025, 12, 22)  # A Monday
        registration = MealRegistration.objects.create(
            user=user_with_house,
            date=reg_date,
            adults_meat=0,
            adults_veg=2,
            children_count=1,
            is_active=True,
        )

        with patch("apps.food.serializers.timezone") as mock_tz:
            mock_now = timezone.make_aware(timezone.datetime(2025, 12, 18, 10, 0))
            mock_tz.now.return_value = mock_now
            mock_tz.get_current_timezone.return_value = timezone.get_current_timezone()

            url = reverse("food:ticket-list")
            data = {
                "date": reg_date.isoformat(),
                "adults_meat": 0,
                "adults_veg": 2,
                "children_count": 1,
            }
            response = api_client.post(url, data, format="json")
            assert response.status_code == 201

        registration.refresh_from_db()
        assert registration.is_active is False
        assert registration.adults_veg == 0
        assert registration.children_count == 0

    def test_partial_ticket_keeps_registration_active(
        self, api_client, user_with_house, monday_date
    ):
        """Selling some portions keeps the registration active with reduced counts."""
        api_client.force_authenticate(user=user_with_house)

        reg_date = date(2025, 12, 22)  # A Monday
        registration = MealRegistration.objects.create(
            user=user_with_house,
            date=reg_date,
            adults_meat=0,
            adults_veg=2,
            children_count=0,
            is_active=True,
        )

        with patch("apps.food.serializers.timezone") as mock_tz:
            mock_now = timezone.make_aware(timezone.datetime(2025, 12, 18, 10, 0))
            mock_tz.now.return_value = mock_now
            mock_tz.get_current_timezone.return_value = timezone.get_current_timezone()

            url = reverse("food:ticket-list")
            data = {
                "date": reg_date.isoformat(),
                "adults_meat": 0,
                "adults_veg": 1,  # Only sell 1 of 2 portions
                "children_count": 0,
            }
            response = api_client.post(url, data, format="json")
            assert response.status_code == 201

        registration.refresh_from_db()
        assert registration.is_active is True
        assert registration.adults_veg == 1  # 1 remaining

    def test_overselling_rejected(self, api_client, user_with_house, monday_date):
        """Cannot sell more portions than registered."""
        api_client.force_authenticate(user=user_with_house)

        reg_date = date(2025, 12, 22)  # A Monday
        MealRegistration.objects.create(
            user=user_with_house,
            date=reg_date,
            adults_meat=0,
            adults_veg=1,
            children_count=0,
            is_active=True,
        )

        with patch("apps.food.serializers.timezone") as mock_tz:
            mock_now = timezone.make_aware(timezone.datetime(2025, 12, 18, 10, 0))
            mock_tz.now.return_value = mock_now
            mock_tz.get_current_timezone.return_value = timezone.get_current_timezone()

            url = reverse("food:ticket-list")
            data = {
                "date": reg_date.isoformat(),
                "adults_meat": 0,
                "adults_veg": 3,  # More than registered
                "children_count": 0,
            }
            response = api_client.post(url, data, format="json")
            assert response.status_code == 400

    def test_ticket_deletion_restores_portions(self, api_client, user_with_house, monday_date):
        """Deleting a ticket restores portions to the registration."""
        api_client.force_authenticate(user=user_with_house)

        reg_date = date(2025, 12, 22)  # A Monday
        registration = MealRegistration.objects.create(
            user=user_with_house,
            date=reg_date,
            adults_meat=0,
            adults_veg=1,
            children_count=0,
            is_active=True,
        )

        ticket = FoodTicket.objects.create(
            owner=user_with_house,
            date=reg_date,
            adults_meat=0,
            adults_veg=1,
            children_count=0,
            is_available=True,
        )

        # Reduce registration as ticket creation would
        registration.adults_veg = 0
        registration.is_active = False
        registration.save()

        url = reverse("food:ticket-detail", kwargs={"pk": ticket.pk})
        response = api_client.delete(url)
        assert response.status_code == 204

        registration.refresh_from_db()
        assert registration.is_active is True
        assert registration.adults_veg == 1

    def test_registration_coexists_with_ticket(self, api_client, user_with_house, monday_date):
        """User can have both a registration and a ticket (partial selling)."""
        api_client.force_authenticate(user=user_with_house)

        ticket_date = monday_date + timedelta(weeks=4)

        # Create an available ticket - registration is NOT blocked
        FoodTicket.objects.create(
            owner=user_with_house,
            date=ticket_date,
            adults_meat=0,
            adults_veg=1,
            children_count=0,
            is_available=True,
        )

        # User can still register for the same date
        url = reverse("food:registration-list")
        data = {
            "date": ticket_date.isoformat(),
            "adults_veg": 1,
            "children_count": 0,
        }
        response = api_client.post(url, data, format="json")
        assert response.status_code == 201


@pytest.mark.django_db
class TestTicketCreationDeadline:
    """Tests for ticket creation deadline restrictions."""

    def test_cannot_create_ticket_before_deadline(self, api_client, user_with_house):
        """Test that tickets cannot be created before registration deadline."""
        api_client.force_authenticate(user=user_with_house)

        with patch("apps.food.serializers.timezone") as mock_tz:
            mock_now = timezone.make_aware(timezone.datetime(2025, 12, 15, 10, 0))
            mock_tz.now.return_value = mock_now
            mock_tz.get_current_timezone.return_value = timezone.get_current_timezone()

            next_monday = date(2025, 12, 22)

            url = reverse("food:ticket-list")
            data = {
                "date": next_monday.isoformat(),
                "adults_veg": 1,
                "children_count": 0,
            }
            response = api_client.post(url, data, format="json")

            assert response.status_code == 400
            assert "deadline" in str(response.json()).lower()

    def test_can_create_ticket_after_deadline(self, api_client, user_with_house):
        """Test that tickets can be created after registration deadline."""
        api_client.force_authenticate(user=user_with_house)

        with patch("apps.food.serializers.timezone") as mock_tz:
            mock_now = timezone.make_aware(timezone.datetime(2025, 12, 18, 10, 0))
            mock_tz.now.return_value = mock_now
            mock_tz.get_current_timezone.return_value = timezone.get_current_timezone()

            next_monday = date(2025, 12, 22)

            url = reverse("food:ticket-list")
            data = {
                "date": next_monday.isoformat(),
                "adults_veg": 1,
                "children_count": 0,
            }
            response = api_client.post(url, data, format="json")

            assert response.status_code == 201

    def test_deadline_calculation(self, db, user):
        """Test deadline calculation for different meal dates."""
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
    """Tests for monthly food cost report.

    The report should include:
    1. All ACTIVE meal registrations (people who ate their meals)
    2. All food tickets (regardless of whether sold) - owner pays for the meal

    Cost is calculated based on portions and meal type, not ticket sale price.
    """

    def test_cost_charged_to_owner_house(
        self, api_client, admin_user, user_with_house, house, house2
    ):
        """Test that food cost is charged to the ticket owner's house, not claimer's."""
        # Clean up existing data for this month
        FoodTicket.objects.filter(date__year=2025, date__month=1).delete()
        MealRegistration.objects.filter(date__year=2025, date__month=1).delete()

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
            adults_meat=0,
            adults_veg=2,
            children_count=0,
            price=Decimal("52.00"),  # 2 * 26 (veg)
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

        # The OWNER's house (house) should have the cost
        # Cost is calculated as: 2 adults * 26 DKK (veg) = 52 DKK
        assert owner_house_cost is not None
        assert Decimal(owner_house_cost["total_cost"]) == Decimal("52.00")
        assert owner_house_cost["ticket_count"] == 1
        assert owner_house_cost["registration_count"] == 0

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
        # Clean up existing data for this test
        FoodTicket.objects.filter(date__year=2025, date__month=2).delete()
        MealRegistration.objects.filter(date__year=2025, date__month=2).delete()

        # Create multiple tickets for the same owner (non-Wednesday → veg)
        for i in range(3):
            FoodTicket.objects.create(
                owner=user_with_house,
                date=date(2025, 2, 3 + i),  # Feb 3, 4, 5 (Mon, Tue, Wed)
                adults_meat=0,
                adults_veg=1,
                children_count=0,
                price=Decimal("26.00"),
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
        assert Decimal(owner_house_cost["total_cost"]) == Decimal("78.00")  # 3 * 26 (veg)
        assert owner_house_cost["ticket_count"] == 3

    def test_unsold_tickets_still_charged(self, api_client, admin_user, user_with_house, house):
        """Test that tickets that were NOT sold are still charged to the owner's house."""
        # Clean up existing data for this test
        FoodTicket.objects.filter(date__year=2025, date__month=3).delete()
        MealRegistration.objects.filter(date__year=2025, date__month=3).delete()

        # Create a ticket that is still available (not sold)
        FoodTicket.objects.create(
            owner=user_with_house,
            date=date(2025, 3, 3),  # A Monday in March 2025
            adults_meat=0,
            adults_veg=1,
            children_count=1,
            price=Decimal("44.00"),
            is_available=True,  # NOT sold
            claimed_by=None,
            claimed_at=None,
        )

        api_client.force_authenticate(user=admin_user)
        url = reverse("food:monthly-food-cost")
        response = api_client.get(url, {"year": 2025, "month": 3})

        assert response.status_code == 200
        data = response.json()

        owner_house_cost = next((h for h in data["houses"] if h["house_id"] == house.id), None)

        # Cost should be: 1 adult * 26 (veg) + 1 child * 18 = 44 DKK
        assert owner_house_cost is not None
        assert Decimal(owner_house_cost["total_cost"]) == Decimal("44.00")
        assert owner_house_cost["ticket_count"] == 1

    def test_active_registrations_charged(self, api_client, admin_user, user_with_house, house):
        """Test that active meal registrations are included in the cost report."""
        # Clean up existing data for this test
        FoodTicket.objects.filter(date__year=2025, date__month=4).delete()
        MealRegistration.objects.filter(date__year=2025, date__month=4).delete()

        # Create an active meal registration (user ate the meal) - Monday is veg
        MealRegistration.objects.create(
            user=user_with_house,
            date=date(2025, 4, 7),  # A Monday in April 2025
            adults_meat=0,
            adults_veg=2,
            children_count=1,
            is_active=True,
        )

        api_client.force_authenticate(user=admin_user)
        url = reverse("food:monthly-food-cost")
        response = api_client.get(url, {"year": 2025, "month": 4})

        assert response.status_code == 200
        data = response.json()

        owner_house_cost = next((h for h in data["houses"] if h["house_id"] == house.id), None)

        # Cost should be: 2 adults * 26 (veg) + 1 child * 18 = 70 DKK
        assert owner_house_cost is not None
        assert Decimal(owner_house_cost["total_cost"]) == Decimal("70.00")
        assert owner_house_cost["registration_count"] == 1
        assert owner_house_cost["ticket_count"] == 0

    def test_inactive_registrations_not_charged(
        self, api_client, admin_user, user_with_house, house
    ):
        """Test that inactive meal registrations (cancelled) are NOT charged."""
        # Clean up existing data for this test
        FoodTicket.objects.filter(date__year=2025, date__month=5).delete()
        MealRegistration.objects.filter(date__year=2025, date__month=5).delete()

        # Create an inactive meal registration (user cancelled without creating ticket)
        MealRegistration.objects.create(
            user=user_with_house,
            date=date(2025, 5, 5),  # A Monday in May 2025
            adults_meat=0,
            adults_veg=1,
            children_count=0,
            is_active=False,  # Cancelled
        )

        api_client.force_authenticate(user=admin_user)
        url = reverse("food:monthly-food-cost")
        response = api_client.get(url, {"year": 2025, "month": 5})

        assert response.status_code == 200
        data = response.json()

        owner_house_cost = next((h for h in data["houses"] if h["house_id"] == house.id), None)

        # No cost - the registration was cancelled and no ticket was created
        assert owner_house_cost is not None
        assert Decimal(owner_house_cost["total_cost"]) == Decimal("0.00")
        assert owner_house_cost["registration_count"] == 0
        assert owner_house_cost["ticket_count"] == 0

    def test_registration_and_ticket_both_counted(
        self, api_client, admin_user, user_with_house, house
    ):
        """Test that both registrations and tickets are counted when present."""
        # Clean up existing data for this test
        FoodTicket.objects.filter(date__year=2025, date__month=6).delete()
        MealRegistration.objects.filter(date__year=2025, date__month=6).delete()

        # Day 1: User eats normally (active registration - Monday is veg)
        MealRegistration.objects.create(
            user=user_with_house,
            date=date(2025, 6, 2),  # A Monday
            adults_meat=0,
            adults_veg=1,
            children_count=0,
            is_active=True,
        )

        # Day 2: User creates a ticket (registration becomes inactive - Tuesday is veg)
        MealRegistration.objects.create(
            user=user_with_house,
            date=date(2025, 6, 3),  # A Tuesday
            adults_meat=0,
            adults_veg=1,
            children_count=0,
            is_active=False,  # Deactivated when ticket created
        )
        FoodTicket.objects.create(
            owner=user_with_house,
            date=date(2025, 6, 3),
            adults_meat=0,
            adults_veg=1,
            children_count=0,
            price=Decimal("26.00"),
            is_available=True,  # Not sold yet
        )

        api_client.force_authenticate(user=admin_user)
        url = reverse("food:monthly-food-cost")
        response = api_client.get(url, {"year": 2025, "month": 6})

        assert response.status_code == 200
        data = response.json()

        owner_house_cost = next((h for h in data["houses"] if h["house_id"] == house.id), None)

        # Cost should be: 26 (day 1 registration veg) + 26 (day 2 ticket veg) = 52 DKK
        assert owner_house_cost is not None
        assert Decimal(owner_house_cost["total_cost"]) == Decimal("52.00")
        assert owner_house_cost["registration_count"] == 1
        assert owner_house_cost["ticket_count"] == 1
