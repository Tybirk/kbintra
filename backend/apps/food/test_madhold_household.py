"""Tests for the household side of madhold, plus two smaller follow-ups.

- The household's shifts: `teams/housemates/` and the evening reminder that
  reaches a cook's partner as well as the cook.
- Over-50 deduced from the birthdate instead of asked on the profile page.
- The pause check sent when a new period opens for wishes.
"""

from datetime import date, timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.food.models import (
    CycleStatus,
    FoodTeam,
    FoodTeamCycle,
    FoodTeamMember,
    FoodTeamWish,
)
from apps.notifications.models import Notification, NotificationType
from apps.users.models import User


@pytest.fixture
def household(db, house):
    """Two residents of the same house — the couple the household features are for."""
    anna = User.objects.create_user(
        email="anna@example.com", password="x", first_name="Anna", house=house
    )
    bo = User.objects.create_user(
        email="bo@example.com", password="x", first_name="Bo", house=house
    )
    return anna, bo


@pytest.fixture
def tomorrows_team(db, admin_user):
    """A team cooking tomorrow, so the 20:00 reminder task has something to find."""
    tomorrow = timezone.localdate() + timedelta(days=1)
    cycle = FoodTeamCycle.objects.create(
        name="I morgen",
        cooking_dates=[tomorrow.isoformat()],
        wish_deadline=timezone.now(),
        status=CycleStatus.FINALIZED,
        created_by=admin_user,
    )
    return FoodTeam.objects.create(cycle=cycle, date=tomorrow)


@pytest.mark.django_db
class TestHouseholdTeams:
    def test_it_lists_the_upcoming_shifts_of_the_other_resident(
        self, api_client, household, admin_user
    ):
        anna, bo = household
        tomorrow = timezone.localdate() + timedelta(days=1)
        cycle = FoodTeamCycle.objects.create(
            name="P",
            cooking_dates=[tomorrow.isoformat()],
            wish_deadline=timezone.now(),
            created_by=admin_user,
        )
        team = FoodTeam.objects.create(cycle=cycle, date=tomorrow)
        FoodTeamMember.objects.create(team=team, user=bo, house_number="1")

        api_client.force_authenticate(user=anna)
        resp = api_client.get(reverse("food:housemate-teams"))

        assert resp.status_code == 200
        rows = resp.data if isinstance(resp.data, list) else resp.data["results"]
        assert len(rows) == 1
        assert rows[0]["id"] == team.id
        assert rows[0]["members_preview"] == [
            {
                "user_id": bo.id,
                "first_name": "Bo",
                "house_number": "1",
                "profile_picture": None,
                "is_own": False,
                "is_housemate": True,
            }
        ]

    def test_your_own_shift_is_not_your_households(self, api_client, household, admin_user):
        anna, _bo = household
        tomorrow = timezone.localdate() + timedelta(days=1)
        cycle = FoodTeamCycle.objects.create(
            name="P",
            cooking_dates=[tomorrow.isoformat()],
            wish_deadline=timezone.now(),
            created_by=admin_user,
        )
        team = FoodTeam.objects.create(cycle=cycle, date=tomorrow)
        FoodTeamMember.objects.create(team=team, user=anna, house_number="1")

        api_client.force_authenticate(user=anna)
        resp = api_client.get(reverse("food:housemate-teams"))

        rows = resp.data if isinstance(resp.data, list) else resp.data["results"]
        assert rows == []

    def test_yesterdays_shift_is_left_out(self, api_client, household, admin_user):
        anna, bo = household
        yesterday = timezone.localdate() - timedelta(days=1)
        cycle = FoodTeamCycle.objects.create(
            name="P",
            cooking_dates=[yesterday.isoformat()],
            wish_deadline=timezone.now(),
            created_by=admin_user,
        )
        team = FoodTeam.objects.create(cycle=cycle, date=yesterday)
        FoodTeamMember.objects.create(team=team, user=bo, house_number="1")

        api_client.force_authenticate(user=anna)
        resp = api_client.get(reverse("food:housemate-teams"))

        rows = resp.data if isinstance(resp.data, list) else resp.data["results"]
        assert rows == []

    def test_a_day_you_cook_together_is_only_your_own(self, api_client, household, admin_user):
        """It is already the card above, with both names on it."""
        anna, bo = household
        tomorrow = timezone.localdate() + timedelta(days=1)
        cycle = FoodTeamCycle.objects.create(
            name="P",
            cooking_dates=[tomorrow.isoformat()],
            wish_deadline=timezone.now(),
            created_by=admin_user,
        )
        team = FoodTeam.objects.create(cycle=cycle, date=tomorrow)
        FoodTeamMember.objects.create(team=team, user=anna, house_number="1")
        FoodTeamMember.objects.create(team=team, user=bo, house_number="1")

        api_client.force_authenticate(user=anna)
        resp = api_client.get(reverse("food:housemate-teams"))

        rows = resp.data if isinstance(resp.data, list) else resp.data["results"]
        assert rows == []

    def test_living_alone_gives_an_empty_list(self, api_client, user_with_house):
        api_client.force_authenticate(user=user_with_house)
        resp = api_client.get(reverse("food:housemate-teams"))

        assert resp.status_code == 200
        rows = resp.data if isinstance(resp.data, list) else resp.data["results"]
        assert rows == []


@pytest.mark.django_db
class TestHouseholdReminder:
    """The 20:00 reminder reaches the cook's household, not just the cook."""

    def test_the_partner_of_tomorrows_cook_is_told(self, household, tomorrows_team):
        from apps.food.tasks import send_food_team_reminders

        anna, bo = household
        FoodTeamMember.objects.create(team=tomorrows_team, user=bo, house_number="1")

        send_food_team_reminders.call_local()

        to_anna = Notification.objects.get(user=anna)
        assert to_anna.notification_type == NotificationType.FOOD_TEAM_REMINDER
        assert "Bo" in to_anna.title
        assert Notification.objects.filter(user=bo).count() == 1

    def test_a_cook_gets_one_reminder_even_when_both_of_them_cook(self, household, tomorrows_team):
        from apps.food.tasks import send_food_team_reminders

        anna, bo = household
        FoodTeamMember.objects.create(team=tomorrows_team, user=anna, house_number="1")
        FoodTeamMember.objects.create(team=tomorrows_team, user=bo, house_number="1")

        send_food_team_reminders.call_local()

        assert Notification.objects.filter(user=anna).count() == 1
        assert Notification.objects.filter(user=bo).count() == 1
        assert Notification.objects.get(user=anna).title == "Du har madhold i morgen"

    def test_another_house_is_not_told(self, household, tomorrows_team, house2):
        from apps.food.tasks import send_food_team_reminders

        _anna, bo = household
        neighbour = User.objects.create_user(
            email="nabo@example.com", password="x", first_name="Nabo", house=house2
        )
        FoodTeamMember.objects.create(team=tomorrows_team, user=bo, house_number="1")

        send_food_team_reminders.call_local()

        assert not Notification.objects.filter(user=neighbour).exists()

    def test_both_cooks_in_a_house_are_named_in_one_message(self, household, tomorrows_team, house):
        from apps.food.tasks import send_food_team_reminders

        anna, bo = household
        child_adult = User.objects.create_user(
            email="cille@example.com", password="x", first_name="Cille", house=house
        )
        FoodTeamMember.objects.create(team=tomorrows_team, user=anna, house_number="1")
        FoodTeamMember.objects.create(team=tomorrows_team, user=bo, house_number="1")

        send_food_team_reminders.call_local()

        assert Notification.objects.get(user=child_adult).title == "Anna og Bo har madhold i morgen"


@pytest.mark.django_db
class TestOverFiftyFromBirthdate:
    """The profile no longer asks: a birthdate on file answers it."""

    def test_the_birthdate_decides_over_the_stored_flag(self, user):
        user.is_over_50 = False
        user.birthdate = date(timezone.localdate().year - 60, 1, 1)
        assert user.is_over_50_effective is True

        user.is_over_50 = True
        user.birthdate = date(timezone.localdate().year - 30, 1, 1)
        assert user.is_over_50_effective is False

    def test_the_flag_still_answers_when_we_have_no_birthdate(self, user):
        user.birthdate = None
        user.is_over_50 = True
        assert user.is_over_50_effective is True

    def test_a_birthday_later_this_year_has_not_happened_yet(self, user):
        today = timezone.localdate()
        # Turns 50 tomorrow — still 49 today.
        tomorrow = today + timedelta(days=1)
        user.birthdate = date(today.year - 50, tomorrow.month, tomorrow.day)
        if user.birthdate <= today.replace(year=today.year - 50):
            pytest.skip("New year's eve edge: the arithmetic is covered by the other cases")
        assert user.is_over_50_effective is False

    def test_the_profile_endpoint_reports_the_deduced_value(self, api_client, user):
        user.birthdate = date(timezone.localdate().year - 60, 1, 1)
        user.is_over_50 = False
        user.save()

        api_client.force_authenticate(user=user)
        resp = api_client.get(reverse("food:my-food-profile"))

        assert resp.data["is_over_50"] is True
        assert resp.data["has_birthdate"] is True

    def test_setting_it_by_hand_is_refused_when_we_know_the_birthdate(self, api_client, user):
        user.birthdate = date(timezone.localdate().year - 30, 1, 1)
        user.save()

        api_client.force_authenticate(user=user)
        resp = api_client.patch(reverse("food:my-food-profile"), {"is_over_50": True})

        assert resp.status_code == 400
        user.refresh_from_db()
        assert user.is_over_50 is False

    def test_it_is_still_editable_without_a_birthdate(self, api_client, user):
        api_client.force_authenticate(user=user)
        resp = api_client.patch(reverse("food:my-food-profile"), {"is_over_50": True})

        assert resp.status_code == 200
        assert resp.data["is_over_50"] is True
        assert resp.data["has_birthdate"] is False
        user.refresh_from_db()
        assert user.is_over_50 is True

    def test_the_generator_balances_on_the_deduced_value(self, house, house2, admin_user):
        """A 60-year-old who never ticked the box still counts as over 50."""
        from apps.food.services.team_generator import TeamGenerator

        monday = timezone.localdate() + timedelta(weeks=120)
        monday += timedelta(days=(7 - monday.weekday()) % 7)
        cycle = FoodTeamCycle.objects.create(
            name="P",
            cooking_dates=[monday.isoformat()],
            wish_deadline=timezone.now() + timedelta(days=1),
            created_by=admin_user,
        )
        elder = User.objects.create_user(
            email="elder@example.com",
            password="x",
            first_name="Elder",
            house=house,
            birthdate=date(timezone.localdate().year - 60, 1, 1),
        )
        generator = TeamGenerator(cycle)
        generator.load_data()

        assert generator.persons[elder.id].is_over_50 is True


@pytest.mark.django_db
class TestDefaultCookingDaysAsWishFallback:
    """No wish submitted? Then the profile's weekdays are the answer."""

    def _cycle(self, admin_user, days: int = 4):
        """A cycle covering the next Mon–Thu."""
        monday = timezone.localdate() + timedelta(weeks=120)
        monday += timedelta(days=(7 - monday.weekday()) % 7)
        dates = [(monday + timedelta(days=d)) for d in range(days)]
        return (
            FoodTeamCycle.objects.create(
                name="P",
                cooking_dates=[d.isoformat() for d in dates],
                wish_deadline=timezone.now() + timedelta(days=1),
                created_by=admin_user,
            ),
            dates,
        )

    def _load(self, cycle):
        from apps.food.services.team_generator import TeamGenerator

        generator = TeamGenerator(cycle)
        generator.load_data()
        return generator

    def test_the_profile_weekdays_stand_in_for_a_missing_wish(self, house, admin_user):
        cycle, dates = self._cycle(admin_user)
        tuesday_person = User.objects.create_user(
            email="tirsdag@example.com",
            password="x",
            first_name="Tirsdag",
            house=house,
            default_cooking_days=[1],
        )

        generator = self._load(cycle)

        assert generator.persons[tuesday_person.id].available_dates == [dates[1]]

    def test_saying_nothing_at_all_still_means_every_date(self, house, admin_user):
        cycle, dates = self._cycle(admin_user)
        quiet = User.objects.create_user(
            email="tavs@example.com", password="x", first_name="Tavs", house=house
        )

        generator = self._load(cycle)

        assert generator.persons[quiet.id].available_dates == dates

    def test_a_submitted_wish_still_wins(self, house, admin_user):
        cycle, dates = self._cycle(admin_user)
        person = User.objects.create_user(
            email="ønsker@example.com",
            password="x",
            first_name="Ønsker",
            house=house,
            default_cooking_days=[1],
        )
        FoodTeamWish.objects.create(
            cycle=cycle, user=person, available_dates=[dates[2].isoformat()]
        )

        generator = self._load(cycle)

        assert generator.persons[person.id].available_dates == [dates[2]]

    def test_weekdays_outside_the_period_fall_back_to_every_date(self, house, admin_user):
        """A Monday-only cook in a Tue–Thu period is available, not unplaceable."""
        cycle, dates = self._cycle(admin_user, days=4)
        cycle.cooking_dates = [d.isoformat() for d in dates[1:]]
        cycle.save(update_fields=["cooking_dates"])
        monday_person = User.objects.create_user(
            email="mandag@example.com",
            password="x",
            first_name="Mandag",
            house=house,
            default_cooking_days=[0],
        )

        generator = self._load(cycle)

        assert generator.persons[monday_person.id].available_dates == dates[1:]


@pytest.mark.django_db
class TestPauseCheckOnNewCycle:
    """Opening a period asks the paused residents whether the break still holds."""

    def _create_cycle(self, api_client, admin_user):
        monday = timezone.localdate() + timedelta(weeks=120)
        monday += timedelta(days=(7 - monday.weekday()) % 7)
        api_client.force_authenticate(user=admin_user)
        return api_client.post(
            reverse("food:cycle-list"),
            {
                "name": "Forår 2027",
                "cooking_dates": [monday.isoformat()],
                "wish_deadline": (timezone.now() + timedelta(days=7)).isoformat(),
            },
            format="json",
        )

    def test_a_paused_resident_is_asked(self, api_client, admin_user, house):
        paused = User.objects.create_user(
            email="paused@example.com",
            password="x",
            first_name="Pauset",
            house=house,
            is_exempt_from_food_teams=True,
        )

        resp = self._create_cycle(api_client, admin_user)

        assert resp.status_code == 201, resp.data
        notification = Notification.objects.get(user=paused)
        assert notification.notification_type == NotificationType.FOOD_TEAM_PAUSE_CHECK
        assert "Forår 2027" in notification.message
        assert notification.link == "/madhold/profil"

    def test_everyone_else_is_left_alone(self, api_client, admin_user, house):
        cooking = User.objects.create_user(
            email="kok@example.com", password="x", first_name="Kok", house=house
        )

        self._create_cycle(api_client, admin_user)

        assert not Notification.objects.filter(user=cooking).exists()

    def test_an_inactive_resident_is_left_alone(self, api_client, admin_user, house):
        gone = User.objects.create_user(
            email="fraflyttet@example.com",
            password="x",
            first_name="Fraflyttet",
            house=house,
            is_exempt_from_food_teams=True,
            is_active=False,
        )

        self._create_cycle(api_client, admin_user)

        assert not Notification.objects.filter(user=gone).exists()
