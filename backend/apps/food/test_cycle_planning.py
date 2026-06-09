"""Tests for next-cycle planning: eligible count, suggested day count,
closed-day exclusion, start-after-last-cycle, and the suggested endpoint."""

from datetime import date, datetime, timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.food.models import ClosedFoodDay, CycleStatus, FoodTeamCycle
from apps.food.services import cycle_planning as planning
from apps.users.models import User


@pytest.mark.django_db
class TestEligibleCount:
    def test_counts_active_non_exempt(self, house):
        User.objects.create_user(email="a@example.com", password="x", first_name="A", house=house)
        User.objects.create_user(
            email="b@example.com",
            password="x",
            first_name="B",
            house=house,
            is_exempt_from_food_teams=True,
        )
        inactive = User.objects.create_user(
            email="c@example.com", password="x", first_name="C", house=house
        )
        inactive.is_active = False
        inactive.save(update_fields=["is_active"])

        assert planning.eligible_food_team_count() == 1

    @pytest.mark.parametrize(
        "eligible,expected",
        [(0, 1), (6, 1), (9, 2), (94, 16), (98, 16), (109, 18)],
    )
    def test_suggested_day_count_rounds(self, eligible, expected):
        assert planning.suggested_day_count(eligible) == expected


@pytest.mark.django_db
class TestSuggestedDates:
    def test_only_mon_thu_and_skips_closed(self):
        # Start on a known Monday far in the future.
        start = date(2030, 1, 7)  # Monday
        assert start.weekday() == 0
        # Close that Wednesday.
        ClosedFoodDay.objects.create(date=date(2030, 1, 9))

        dates = planning.next_cooking_dates(4, start=start)
        parsed = [date.fromisoformat(d) for d in dates]

        # No weekends/Fridays, no closed day.
        assert all(d.weekday() <= 3 for d in parsed)
        assert date(2030, 1, 9) not in parsed
        # Mon, Tue, Thu of week 1, then Mon of week 2 (Wed skipped).
        assert parsed == [
            date(2030, 1, 7),
            date(2030, 1, 8),
            date(2030, 1, 10),
            date(2030, 1, 14),
        ]

    def test_start_after_last_existing_cycle(self, admin_user):
        last = timezone.localdate() + timedelta(weeks=50)
        # Snap to a Monday for predictability.
        last -= timedelta(days=last.weekday())
        FoodTeamCycle.objects.create(
            name="Existing",
            cooking_dates=[last.isoformat(), (last + timedelta(days=1)).isoformat()],
            wish_deadline=timezone.now() + timedelta(days=1),
            status=CycleStatus.FINALIZED,
            created_by=admin_user,
        )
        start = planning.suggested_start_date()
        # Must begin strictly after the last cooking date of the existing cycle.
        assert start > last + timedelta(days=1)

    def test_start_is_tomorrow_without_future_cycles(self):
        today = date(2030, 6, 1)
        assert planning.suggested_start_date(today=today) == date(2030, 6, 2)

    def test_cycle_ending_wednesday_suggests_thursday(self, admin_user):
        """A cycle that ends on a Wednesday → next suggestion starts Thursday."""
        wed = date(2030, 1, 9)  # Wednesday
        assert wed.weekday() == 2
        FoodTeamCycle.objects.create(
            name="Ends Wednesday",
            cooking_dates=[date(2030, 1, 8).isoformat(), wed.isoformat()],
            wish_deadline=timezone.now() + timedelta(days=1),
            status=CycleStatus.FINALIZED,
            created_by=admin_user,
        )
        start = planning.suggested_start_date(today=date(2030, 1, 1))
        assert start == date(2030, 1, 10)  # Thursday
        first = date.fromisoformat(planning.next_cooking_dates(3, start=start)[0])
        assert first == date(2030, 1, 10)
        assert first.weekday() == 3  # Thursday is a valid cooking day


@pytest.mark.django_db
class TestSuggestedEndpoint:
    def test_requires_food_admin(self, authenticated_client):
        url = reverse("food:cycle-suggested")
        resp = authenticated_client.get(url)
        assert resp.status_code == 403

    def test_returns_plan_for_admin(self, admin_client, house):
        User.objects.create_user(
            email="cook@example.com", password="x", first_name="Cook", house=house
        )
        url = reverse("food:cycle-suggested")
        resp = admin_client.get(url)
        assert resp.status_code == 200
        data = resp.json()
        assert data["eligible_count"] >= 1
        assert data["suggested_day_count"] == len(data["cooking_dates"])
        assert data["name"].startswith("Madhold")
        # Deadline is before the first cooking day.
        first = date.fromisoformat(data["cooking_dates"][0])
        deadline = datetime.fromisoformat(data["wish_deadline"]).date()
        assert deadline < first
