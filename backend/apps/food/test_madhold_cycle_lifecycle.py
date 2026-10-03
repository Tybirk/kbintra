"""A madhold period plans only its own days, only residents, and only in time.

Found in the 2026-10-02 bug hunt (docs/madhold-bughunt-2026-10-02.md, C1–C7).
"""

from datetime import UTC, datetime, time, timedelta
from unittest.mock import patch

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
from apps.houses.models import House
from apps.notifications.models import Notification, NotificationType
from apps.users.models import User


def _monday_in(weeks: int):
    base = timezone.localdate() + timedelta(weeks=weeks)
    return base + timedelta(days=(7 - base.weekday()) % 7)


def _cooks(n: int, prefix: str = "kok") -> list[User]:
    """n cooks, one per house, all head-chef capable, so any plan is feasible."""
    cooks = []
    for i in range(n):
        h = House.objects.create(name=f"{prefix} hus {i}", slug=f"{prefix}{i}")
        cooks.append(
            User.objects.create_user(
                email=f"{prefix}{i}@periode.dk",
                password="x",
                first_name=f"{prefix.title()}{i}",
                house=h,
                can_be_head_chef=True,
            )
        )
    return cooks


@pytest.fixture
def food_admin(db):
    """A food admin who lives in a house and is on a pause (so not in the pool)."""
    h = House.objects.create(name="Admin hus", slug="99")
    return User.objects.create_user(
        email="foodadmin@periode.dk",
        password="x",
        first_name="Madadmin",
        house=h,
        is_food_admin=True,
        is_exempt_from_food_teams=True,
    )


def _open_cycle(dates, deadline_in=timedelta(minutes=-1), name="P"):
    return FoodTeamCycle.objects.create(
        name=name,
        cooking_dates=[d.isoformat() for d in dates],
        wish_deadline=timezone.now() + deadline_in,
        status=CycleStatus.COLLECTING_WISHES,
    )


# --------------------------------------------------------------------------- #
# C1. Only residents.                                                          #
# --------------------------------------------------------------------------- #


@pytest.mark.django_db
def test_an_account_without_a_house_is_neither_invited_nor_planned(api_client, food_admin):
    houseless = User.objects.create_user(
        email="drift@periode.dk", password="x", first_name="Driftkonto"
    )
    _cooks(12)

    api_client.force_authenticate(user=food_admin)
    d1 = _monday_in(20)
    response = api_client.post(
        reverse("food:cycle-list"),
        {
            "name": "Periode",
            "cooking_dates": [d1.isoformat(), (d1 + timedelta(days=1)).isoformat()],
            "wish_deadline": (timezone.now() + timedelta(days=5)).isoformat(),
        },
        format="json",
    )
    assert response.status_code == 201, response.data
    cycle = FoodTeamCycle.objects.get(name="Periode")
    cycle.wish_deadline = timezone.now() - timedelta(minutes=1)
    cycle.save()
    response = api_client.post(
        reverse("food:generate-teams"), {"cycle_id": cycle.id}, format="json"
    )
    assert response.data["teams_created"] == 2

    assert not Notification.objects.filter(user=houseless).exists()
    assert not FoodTeamMember.objects.filter(user=houseless).exists()


@pytest.mark.django_db
def test_the_wish_nudge_skips_accounts_without_a_house():
    from apps.food.tasks import send_wish_deadline_reminders

    houseless = User.objects.create_user(
        email="drift@periode.dk", password="x", first_name="Driftkonto"
    )
    (resident,) = _cooks(1)
    _open_cycle([_monday_in(20)], deadline_in=timedelta(hours=30))

    send_wish_deadline_reminders()

    assert Notification.objects.filter(user=resident).exists()
    assert not Notification.objects.filter(user=houseless).exists()


# --------------------------------------------------------------------------- #
# C2. A date belongs to one period.                                            #
# --------------------------------------------------------------------------- #


@pytest.mark.django_db
class TestOverlappingPeriods:
    def _finalized_cycle_a(self, d1):
        a = FoodTeamCycle.objects.create(
            name="Periode A",
            cooking_dates=[d1.isoformat()],
            wish_deadline=timezone.now() - timedelta(days=1),
            status=CycleStatus.FINALIZED,
        )
        team = FoodTeam.objects.create(cycle=a, date=d1)
        h = House.objects.create(name="A hus", slug="a1")
        alice = User.objects.create_user(
            email="alice@periode.dk",
            password="x",
            first_name="Alice",
            house=h,
            is_exempt_from_food_teams=True,  # keep her out of B's pool
        )
        FoodTeamMember.objects.create(team=team, user=alice, house_number="a1")
        return a, team

    def test_opening_a_period_on_another_periods_dates_is_refused(self, api_client, food_admin):
        d1 = _monday_in(20)
        self._finalized_cycle_a(d1)

        api_client.force_authenticate(user=food_admin)
        response = api_client.post(
            reverse("food:cycle-list"),
            {
                "name": "Periode B",
                "cooking_dates": [d1.isoformat(), (d1 + timedelta(days=1)).isoformat()],
                "wish_deadline": (timezone.now() + timedelta(days=5)).isoformat(),
            },
            format="json",
        )

        assert response.status_code == 400
        assert "Periode A" in str(response.data["cooking_dates"])

    def test_moving_a_period_onto_another_periods_dates_is_refused(self, api_client, food_admin):
        d1 = _monday_in(20)
        self._finalized_cycle_a(d1)
        b = _open_cycle([d1 + timedelta(days=7)], deadline_in=timedelta(days=5), name="B")

        api_client.force_authenticate(user=food_admin)
        response = api_client.patch(
            reverse("food:cycle-detail", args=[b.id]),
            {"cooking_dates": [d1.isoformat()]},
            format="json",
        )

        assert response.status_code == 400

    def test_a_period_may_keep_its_own_dates_when_edited(self, api_client, food_admin):
        d1 = _monday_in(20)
        b = _open_cycle([d1], deadline_in=timedelta(days=5), name="B")

        api_client.force_authenticate(user=food_admin)
        response = api_client.patch(
            reverse("food:cycle-detail", args=[b.id]),
            {"cooking_dates": [d1.isoformat(), (d1 + timedelta(days=1)).isoformat()]},
            format="json",
        )

        assert response.status_code == 200, response.data

    def test_generating_one_period_leaves_another_periods_team_alone(self, api_client, food_admin):
        d1 = _monday_in(20)
        _a, team_a = self._finalized_cycle_a(d1)
        b = _open_cycle([d1, d1 + timedelta(days=1)], name="Periode B")
        _cooks(12)

        api_client.force_authenticate(user=food_admin)
        response = api_client.post(
            reverse("food:generate-teams"), {"cycle_id": b.id}, format="json"
        )

        assert response.status_code == 200
        assert response.data["success"] is False
        assert "Periode A" in response.data["message"]
        assert FoodTeam.objects.filter(pk=team_a.pk).exists()
        assert team_a.members.count() == 1

    def test_resetting_one_period_leaves_another_periods_team_alone(self, api_client, food_admin):
        d1 = _monday_in(20)
        _a, team_a = self._finalized_cycle_a(d1)
        # A period whose date list still names d1 (data from before this check).
        b = FoodTeamCycle.objects.create(
            name="B",
            cooking_dates=[d1.isoformat(), (d1 + timedelta(days=1)).isoformat()],
            wish_deadline=timezone.now() - timedelta(days=1),
            status=CycleStatus.FINALIZED,
        )
        FoodTeam.objects.create(cycle=b, date=d1 + timedelta(days=1))

        api_client.force_authenticate(user=food_admin)
        response = api_client.post(reverse("food:cycle-reset-teams", args=[b.id]))

        assert response.status_code == 200, response.data
        assert FoodTeam.objects.filter(pk=team_a.pk).exists()
        assert not FoodTeam.objects.filter(cycle=b).exists()


# --------------------------------------------------------------------------- #
# C3. "Generer hold" before the deadline needs a yes.                          #
# --------------------------------------------------------------------------- #


@pytest.mark.django_db
class TestGenerateBeforeDeadline:
    def _cycle(self):
        d1 = _monday_in(20)
        return _open_cycle([d1, d1 + timedelta(days=1)], deadline_in=timedelta(days=3))

    def test_refused_without_confirmation(self, api_client, food_admin):
        cycle = self._cycle()
        _cooks(12)

        api_client.force_authenticate(user=food_admin)
        response = api_client.post(
            reverse("food:generate-teams"), {"cycle_id": cycle.id}, format="json"
        )

        assert response.status_code == 400
        cycle.refresh_from_db()
        assert cycle.status == CycleStatus.COLLECTING_WISHES
        assert not FoodTeam.objects.exists()
        assert not Notification.objects.filter(
            notification_type=NotificationType.FOOD_TEAM_PLAN_READY
        ).exists()

    def test_a_dry_run_needs_no_confirmation(self, api_client, food_admin):
        cycle = self._cycle()
        _cooks(12)

        api_client.force_authenticate(user=food_admin)
        response = api_client.post(
            reverse("food:generate-teams"),
            {"cycle_id": cycle.id, "dry_run": True},
            format="json",
        )

        assert response.status_code == 200
        assert not FoodTeam.objects.exists()

    def test_planned_when_the_admin_confirms(self, api_client, food_admin):
        cycle = self._cycle()
        _cooks(12)

        api_client.force_authenticate(user=food_admin)
        response = api_client.post(
            reverse("food:generate-teams"),
            {"cycle_id": cycle.id, "before_deadline": True},
            format="json",
        )

        assert response.status_code == 200
        assert response.data["teams_created"] == 2


# --------------------------------------------------------------------------- #
# C4. A late period plans only the days still ahead, in time for day 1.        #
# --------------------------------------------------------------------------- #


@pytest.mark.django_db
def test_generate_does_not_plan_or_announce_days_already_past(api_client, food_admin):
    today = timezone.localdate()
    yesterday = today - timedelta(days=1)
    later = _monday_in(3)
    cycle = _open_cycle([yesterday, today, later], deadline_in=timedelta(days=-2))
    _cooks(12)

    api_client.force_authenticate(user=food_admin)
    response = api_client.post(
        reverse("food:generate-teams"), {"cycle_id": cycle.id}, format="json"
    )

    assert response.data["teams_created"] == 1
    assert list(FoodTeam.objects.values_list("date", flat=True)) == [later]
    assert any("passeret" in w for w in response.data["warnings"])
    cycle.refresh_from_db()
    assert cycle.cooking_dates == [later.isoformat()]
    for note in Notification.objects.filter(
        notification_type=NotificationType.FOOD_TEAM_PLAN_READY
    ):
        assert f"{yesterday.day}/{yesterday.month}" not in note.message


@pytest.mark.django_db
def test_suggested_deadline_leaves_time_to_plan_before_the_first_reminder(admin_client):
    response = admin_client.get(reverse("food:cycle-suggested"))

    assert response.status_code == 200
    first = datetime.fromisoformat(response.data["cooking_dates"][0]).date()
    deadline = datetime.fromisoformat(response.data["wish_deadline"])
    first_reminder = timezone.make_aware(datetime.combine(first - timedelta(days=1), time(20)))
    # A full day between the deadline and the first reminder, to generate in.
    assert deadline <= first_reminder - timedelta(hours=20)
    assert deadline > timezone.now()


@pytest.mark.django_db
def test_suggested_period_never_starts_sooner_than_it_can_be_planned(admin_client):
    # The latest period ends today, so "the day after" would be tomorrow.
    today = timezone.localdate()
    FoodTeamCycle.objects.create(
        name="Nu",
        cooking_dates=[today.isoformat()],
        wish_deadline=timezone.now() - timedelta(days=3),
        status=CycleStatus.FINALIZED,
    )

    response = admin_client.get(reverse("food:cycle-suggested"))

    first = datetime.fromisoformat(response.data["cooking_dates"][0]).date()
    assert first >= today + timedelta(days=3)


# --------------------------------------------------------------------------- #
# C5. No reset while a team is cooking.                                        #
# --------------------------------------------------------------------------- #


@pytest.mark.django_db
def test_reset_is_refused_on_a_cooking_day(api_client, food_admin, house):
    today = timezone.localdate()
    cycle = FoodTeamCycle.objects.create(
        name="P",
        cooking_dates=[today.isoformat(), _monday_in(3).isoformat()],
        wish_deadline=timezone.now() - timedelta(days=3),
        status=CycleStatus.FINALIZED,
    )
    team = FoodTeam.objects.create(cycle=cycle, date=today)
    cook = User.objects.create_user(
        email="today@periode.dk", password="x", first_name="Idag", house=house
    )
    FoodTeamMember.objects.create(team=team, user=cook, house_number="1")

    api_client.force_authenticate(user=food_admin)
    response = api_client.post(reverse("food:cycle-reset-teams", args=[cycle.id]))

    assert response.status_code == 400
    assert FoodTeam.objects.filter(pk=team.pk).exists()


# --------------------------------------------------------------------------- #
# C6. Correcting a wish gives back the pause it lifted.                        #
# --------------------------------------------------------------------------- #


@pytest.mark.django_db
class TestPauseAndCorrectedWish:
    def _paused(self, house):
        return User.objects.create_user(
            email="barsel@periode.dk",
            password="x",
            first_name="Barsel",
            house=house,
            is_exempt_from_food_teams=True,
            food_team_pause_reason="Barsel til marts",
        )

    def _submit(self, api_client, cycle, **data):
        url = reverse("food:my-wish", kwargs={"cycle_id": cycle.id})
        response = api_client.post(url, data, format="json")
        assert response.status_code in (200, 201), response.data

    def test_correcting_back_to_kan_ikke_restores_the_pause_and_its_reason(self, api_client, house):
        d1 = _monday_in(20)
        cycle = _open_cycle([d1], deadline_in=timedelta(days=5))
        paused = self._paused(house)
        api_client.force_authenticate(user=paused)

        self._submit(api_client, cycle, available_dates=[d1.isoformat()], is_unavailable=False)
        paused.refresh_from_db()
        assert paused.is_exempt_from_food_teams is False
        assert paused.food_team_pause_reason == ""

        # The form no longer has the reason (it was cleared), so it sends none.
        self._submit(api_client, cycle, available_dates=[], is_unavailable=True, pause_reason="")

        paused.refresh_from_db()
        assert paused.is_exempt_from_food_teams is True
        assert paused.food_team_pause_reason == "Barsel til marts"
        assert FoodTeamWish.objects.get(user=paused).lifted_pause is False

    def test_a_new_reason_given_with_the_correction_wins(self, api_client, house):
        d1 = _monday_in(20)
        cycle = _open_cycle([d1], deadline_in=timedelta(days=5))
        paused = self._paused(house)
        api_client.force_authenticate(user=paused)

        self._submit(api_client, cycle, available_dates=[d1.isoformat()], is_unavailable=False)
        self._submit(
            api_client, cycle, available_dates=[], is_unavailable=True, pause_reason="Rejser"
        )

        paused.refresh_from_db()
        assert paused.is_exempt_from_food_teams is True
        assert paused.food_team_pause_reason == "Rejser"

    def test_kan_ikke_without_a_lifted_pause_still_does_not_pause(self, api_client, house):
        d1 = _monday_in(20)
        cycle = _open_cycle([d1], deadline_in=timedelta(days=5))
        resident = User.objects.create_user(
            email="aktiv@periode.dk", password="x", first_name="Aktiv", house=house
        )
        api_client.force_authenticate(user=resident)

        self._submit(api_client, cycle, available_dates=[d1.isoformat()], is_unavailable=False)
        self._submit(
            api_client, cycle, available_dates=[], is_unavailable=True, pause_reason="Rejser"
        )

        resident.refresh_from_db()
        assert resident.is_exempt_from_food_teams is False
        assert resident.food_team_pause_reason == "Rejser"


# --------------------------------------------------------------------------- #
# C7. "Alle hold" is upcoming in Danish time.                                  #
# --------------------------------------------------------------------------- #


@pytest.mark.django_db
def test_alle_hold_drops_yesterday_just_after_midnight(api_client, user):
    d1 = _monday_in(20)
    cycle = _open_cycle([d1, d1 + timedelta(days=1)])
    FoodTeam.objects.create(cycle=cycle, date=d1)
    FoodTeam.objects.create(cycle=cycle, date=d1 + timedelta(days=1))
    # 01:30 in Copenhagen on the day after d1 is still d1 in UTC.
    just_after_midnight = timezone.make_aware(
        datetime.combine(d1 + timedelta(days=1), time(1, 30))
    ).astimezone(UTC)

    api_client.force_authenticate(user=user)
    with patch("django.utils.timezone.now", return_value=just_after_midnight):
        response = api_client.get(reverse("food:team-list"))

    dates = [row["date"] for row in response.data]
    assert d1.isoformat() not in dates
    assert (d1 + timedelta(days=1)).isoformat() in dates
