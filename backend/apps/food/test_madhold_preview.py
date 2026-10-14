"""Checking a madhold plan before anyone hears about it.

- A dry run ("Forhåndsvisning") returns the whole plan, team by team, and saves
  and announces nothing.
- A child with an account (``User.is_child``) is never a cook, whatever their age.
- A house with more cooks than usual is flagged, since that is how a child who
  is not marked as one shows up.
"""

from datetime import date, timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.food.models import CycleStatus, FoodTeam, FoodTeamCycle
from apps.food.services.team_generator import TeamGenerator
from apps.food.utils import food_team_pool
from apps.houses.models import House
from apps.notifications.models import Notification
from apps.users.models import User


def _monday() -> date:
    monday = timezone.localdate() + timedelta(weeks=120)
    return monday + timedelta(days=(7 - monday.weekday()) % 7)


def _cycle(admin_user, days: int = 2) -> FoodTeamCycle:
    return FoodTeamCycle.objects.create(
        name="P",
        cooking_dates=[(_monday() + timedelta(days=d)).isoformat() for d in range(days)],
        wish_deadline=timezone.now() - timedelta(hours=1),
        created_by=admin_user,
    )


def _residents(count: int, per_house: int = 2) -> list[User]:
    """``count`` residents, ``per_house`` to a house, every third a head chef."""
    people = []
    for i in range(count):
        house, _ = House.objects.get_or_create(name=f"Hus {i // per_house + 1}")
        people.append(
            User.objects.create_user(
                email=f"kok{i}@example.com",
                password="x",
                first_name=f"Kok{i}",
                last_name="Testesen",
                house=house,
                can_be_head_chef=i % 3 == 0,
            )
        )
    return people


@pytest.mark.django_db
class TestPreviewShowsThePlan:
    def _generate(self, api_client, admin_user, cycle, dry_run: bool):
        api_client.force_authenticate(user=admin_user)
        return api_client.post(
            reverse("food:generate-teams"),
            {"cycle_id": cycle.id, "dry_run": dry_run},
            format="json",
        )

    def test_a_dry_run_returns_every_team_with_its_cooks(self, api_client, admin_user):
        cycle = _cycle(admin_user, days=2)
        _residents(12)

        resp = self._generate(api_client, admin_user, cycle, dry_run=True)

        assert resp.status_code == 200, resp.data
        teams = resp.data["teams"]
        assert [t["date"] for t in teams] == cycle.cooking_dates
        planned = [m["name"] for t in teams for m in t["members"]]
        assert sorted(planned) == sorted(f"Kok{i} Testesen" for i in range(12))
        member = teams[0]["members"][0]
        assert set(member) == {
            "name",
            "house_number",
            "is_over_50",
            "can_be_head_chef",
            "prefers_housemate",
        }

    def test_a_dry_run_saves_and_announces_nothing(self, api_client, admin_user):
        cycle = _cycle(admin_user, days=2)
        _residents(12)

        self._generate(api_client, admin_user, cycle, dry_run=True)

        cycle.refresh_from_db()
        assert cycle.status == CycleStatus.COLLECTING_WISHES
        assert not FoodTeam.objects.exists()
        assert not Notification.objects.exists()

    def test_a_real_run_returns_the_same_shape(self, api_client, admin_user):
        cycle = _cycle(admin_user, days=2)
        _residents(12)

        resp = self._generate(api_client, admin_user, cycle, dry_run=False)

        assert resp.data["teams_created"] == 2
        saved = {
            t.date.isoformat(): sorted(m.user.first_name for m in t.members.all())
            for t in FoodTeam.objects.prefetch_related("members__user")
        }
        returned = {
            t["date"]: sorted(m["name"].split()[0] for m in t["members"])
            for t in resp.data["teams"]
        }
        assert returned == saved


@pytest.mark.django_db
class TestChildWithAnAccount:
    def test_a_child_is_not_in_the_pool_whatever_their_age(self, house):
        adult_child = User.objects.create_user(
            email="barn@example.com",
            password="x",
            first_name="Barn",
            house=house,
            birthdate=date(timezone.localdate().year - 20, 1, 1),
            is_child=True,
        )

        assert adult_child not in food_team_pool()

    def test_the_generator_does_not_plan_a_child(self, admin_user, house):
        cycle = _cycle(admin_user, days=1)
        child = User.objects.create_user(
            email="barn@example.com", password="x", first_name="Barn", house=house, is_child=True
        )

        generator = TeamGenerator(cycle)
        generator.load_data()

        assert child.id not in generator.persons

    def test_a_child_is_neither_invited_nor_asked_about_a_pause(
        self, api_client, admin_user, house
    ):
        child = User.objects.create_user(
            email="barn@example.com", password="x", first_name="Barn", house=house, is_child=True
        )
        api_client.force_authenticate(user=admin_user)

        resp = api_client.post(
            reverse("food:cycle-list"),
            {
                "name": "Forår 2027",
                "cooking_dates": [_monday().isoformat()],
                "wish_deadline": (timezone.now() + timedelta(days=7)).isoformat(),
            },
            format="json",
        )

        assert resp.status_code == 201, resp.data
        assert not Notification.objects.filter(user=child).exists()

    def test_a_food_admin_can_mark_a_child_from_the_roster(self, api_client, admin_user, house):
        child = User.objects.create_user(
            email="barn@example.com", password="x", first_name="Barn", house=house
        )
        api_client.force_authenticate(user=admin_user)

        resp = api_client.patch(
            reverse("food:food-roster-detail", args=[child.id]), {"is_child": True}, format="json"
        )

        assert resp.status_code == 200, resp.data
        child.refresh_from_db()
        assert child.is_child is True
        roster = api_client.get(reverse("food:food-roster")).data["residents"]
        assert next(r for r in roster if r["id"] == child.id)["is_child"] is True


@pytest.mark.django_db
class TestCrowdedHouseWarning:
    def _warnings(self, admin_user) -> list[str]:
        generator = TeamGenerator(_cycle(admin_user, days=1))
        generator.load_data()
        return generator.warnings

    def test_three_cooks_in_one_house_are_flagged_by_name(self, admin_user):
        _residents(3, per_house=3)

        warnings = self._warnings(admin_user)

        assert len(warnings) == 1
        assert "Hus 1 har 3 kokke med (Kok0, Kok1, Kok2)" in warnings[0]

    def test_two_cooks_in_a_house_is_normal(self, admin_user):
        _residents(4, per_house=2)

        assert self._warnings(admin_user) == []

    def test_marking_the_child_clears_the_warning(self, admin_user):
        people = _residents(3, per_house=3)
        people[2].is_child = True
        people[2].save(update_fields=["is_child"])

        assert self._warnings(admin_user) == []


@pytest.mark.django_db
class TestWhySomeoneIsUnplaced:
    def test_a_housemate_on_the_only_date_is_named_not_the_over_50_cap(self, admin_user):
        """Two housemates who can both only cook the same day: one is placed, and the
        warning about the other names the housemate, not the over-50 limit."""
        from apps.food.models import FoodTeamWish

        cycle = _cycle(admin_user, days=2)
        people = _residents(12, per_house=1)
        house = people[0].house
        bo = User.objects.create_user(
            email="bo@example.com", password="x", first_name="Bo", house=house
        )
        only_day = cycle.cooking_dates[0]
        for person in (people[0], bo):
            FoodTeamWish.objects.create(cycle=cycle, user=person, available_dates=[only_day])

        generator = TeamGenerator(cycle)
        result = generator.generate(save=False)

        unplaced = result.unassigned_persons
        assert len(unplaced) == 1
        placed = "Bo" if unplaced == ["Kok0"] else "Kok0"
        day = date.fromisoformat(only_day)
        assert (
            f"{unplaced[0]} (hus 1) kunne ikke sættes på et hold. "
            f"{day.day}/{day.month}: {placed} fra samme hus er allerede på holdet."
        ) in result.warnings
        assert not any("over-50" in w for w in result.warnings)


@pytest.mark.django_db
class TestWarningsDescribeTheFinalPlan:
    def test_a_couple_placed_together_on_a_retry_is_not_reported_as_split(self, admin_user):
        """Both over 50: the first attempt (max 2 over-50 per team) can't fit them next
        to the over-50s already there, a retry with a higher cap can. The plan has
        them together, so the warnings must not say otherwise."""
        cycle = _cycle(admin_user, days=1)
        for i in range(2):
            User.objects.create_user(
                email=f"ung{i}@example.com",
                password="x",
                first_name=f"Ung{i}",
                house=House.objects.create(name=f"Hus {60 + i}"),
            )
        old = date(timezone.localdate().year - 60, 1, 1)
        # Head chefs are placed before the couple, so they take the two over-50
        # seats the first attempt allows.
        for i in range(2):
            User.objects.create_user(
                email=f"old{i}@example.com",
                password="x",
                first_name=f"Ældre{i}",
                house=House.objects.create(name=f"Hus {50 + i}"),
                birthdate=old,
                can_be_head_chef=True,
            )
        couple_house = House.objects.create(name="Hus 43")
        for name in ("Anne", "Helge"):
            User.objects.create_user(
                email=f"{name.lower()}@example.com",
                password="x",
                first_name=name,
                house=couple_house,
                birthdate=old,
                prefers_cooking_with_housemate=True,
            )

        generator = TeamGenerator(cycle)
        result = generator.generate(save=False)

        names = {m.name.split()[0] for t in result.teams for m in t.members}
        assert {"Anne", "Helge"} <= names
        assert not any("kunne ikke placeres sammen" in w for w in result.warnings)
