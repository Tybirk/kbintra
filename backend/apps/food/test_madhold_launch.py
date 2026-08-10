"""Tests for the madhold launch features: takeover/favours, broadcast swaps,
self-service profile, today action box, and per-cycle unavailability."""

from datetime import timedelta

import pytest
from django.urls import reverse

from apps.food.models import (
    BroadcastStatus,
    FoodTeam,
    FoodTeamMember,
    FoodTeamWish,
    SwapBroadcast,
    TeamFavour,
)
from apps.users.models import User


@pytest.fixture
def future_monday():
    """A Monday safely in the future so date >= today checks pass."""
    from django.utils import timezone

    base = timezone.localdate() + timedelta(weeks=120)
    return base + timedelta(days=(7 - base.weekday()) % 7)


@pytest.fixture
def cycle_with_two_teams(db, admin_user, future_monday):
    """A cycle with two teams on consecutive cooking days (Mon + Tue)."""
    from django.utils import timezone

    from apps.food.models import CycleStatus, FoodTeamCycle

    d1 = future_monday
    d2 = future_monday + timedelta(days=1)
    cycle = FoodTeamCycle.objects.create(
        name="Launch Test Cycle",
        cooking_dates=[d1.isoformat(), d2.isoformat()],
        wish_deadline=timezone.now() + timedelta(days=7),
        status=CycleStatus.COLLECTING_WISHES,
        created_by=admin_user,
    )
    team1 = FoodTeam.objects.create(cycle=cycle, date=d1)
    team2 = FoodTeam.objects.create(cycle=cycle, date=d2)
    return cycle, team1, team2, d1, d2


@pytest.mark.django_db
class TestTakeover:
    def test_takeover_reassigns_membership_and_creates_favour(
        self, api_client, house, house2, cycle_with_two_teams
    ):
        _cycle, team1, _team2, _d1, _d2 = cycle_with_two_teams
        me = User.objects.create_user(
            email="me@example.com", password="x", first_name="Me", house=house
        )
        victim = User.objects.create_user(
            email="victim@example.com", password="x", first_name="Victim", house=house2
        )
        membership = FoodTeamMember.objects.create(team=team1, user=victim, house_number="2")

        api_client.force_authenticate(user=me)
        resp = api_client.post(
            reverse("food:team-takeover"), {"target_membership_id": membership.id}
        )
        assert resp.status_code == 201, resp.data

        membership.refresh_from_db()
        assert membership.user_id == me.id
        favour = TeamFavour.objects.get(creditor=me, debtor=victim)
        assert favour.origin_date == team1.date
        assert favour.settled is False

    def test_cannot_take_over_own_shift(self, api_client, house, cycle_with_two_teams):
        _cycle, team1, _team2, _d1, _d2 = cycle_with_two_teams
        me = User.objects.create_user(
            email="me2@example.com", password="x", first_name="Me", house=house
        )
        membership = FoodTeamMember.objects.create(team=team1, user=me, house_number="1")
        api_client.force_authenticate(user=me)
        resp = api_client.post(
            reverse("food:team-takeover"), {"target_membership_id": membership.id}
        )
        assert resp.status_code == 400


@pytest.mark.django_db
class TestSwapBroadcast:
    def test_create_computes_candidates_and_accept_swaps(
        self, api_client, house, house2, cycle_with_two_teams
    ):
        cycle, team1, team2, d1, d2 = cycle_with_two_teams
        requester = User.objects.create_user(
            email="req@example.com", password="x", first_name="Req", house=house
        )
        # Candidate cooks d2 and is available on d1 (requester's date) by weekday.
        candidate = User.objects.create_user(
            email="cand@example.com",
            password="x",
            first_name="Cand",
            house=house2,
            default_cooking_days=[d1.weekday()],
        )
        req_membership = FoodTeamMember.objects.create(team=team1, user=requester, house_number="1")
        cand_membership = FoodTeamMember.objects.create(
            team=team2, user=candidate, house_number="2"
        )

        # Requester broadcasts: get rid of d1, willing to take d2.
        api_client.force_authenticate(user=requester)
        resp = api_client.post(
            reverse("food:swap-broadcast-list"),
            {"requester_membership_id": req_membership.id, "available_dates": [d2.isoformat()]},
            format="json",
        )
        assert resp.status_code == 201, resp.data
        assert resp.data["candidate_count"] == 1
        broadcast = SwapBroadcast.objects.get(requester=requester)
        assert candidate.id in broadcast.candidate_user_ids

        # Candidate accepts with their d2 membership.
        api_client.force_authenticate(user=candidate)
        accept = api_client.post(
            reverse("food:swap-broadcast-accept", kwargs={"pk": broadcast.id}),
            {"membership_id": cand_membership.id},
            format="json",
        )
        assert accept.status_code == 200, accept.data

        req_membership.refresh_from_db()
        cand_membership.refresh_from_db()
        # Users swapped between the two dates.
        assert req_membership.user_id == candidate.id
        assert cand_membership.user_id == requester.id
        broadcast.refresh_from_db()
        assert broadcast.status == BroadcastStatus.ACCEPTED
        assert broadcast.accepted_by_id == candidate.id


@pytest.mark.django_db
class TestMyFoodProfile:
    def test_get_and_patch_profile(self, api_client, user_with_house):
        api_client.force_authenticate(user=user_with_house)
        url = reverse("food:my-food-profile")
        resp = api_client.get(url)
        assert resp.status_code == 200
        assert "can_be_head_chef" in resp.data
        assert "housemate_name" in resp.data

        patch = api_client.patch(
            url, {"can_be_head_chef": True, "default_cooking_days": [0, 2]}, format="json"
        )
        assert patch.status_code == 200
        user_with_house.refresh_from_db()
        assert user_with_house.can_be_head_chef is True
        assert user_with_house.default_cooking_days == [0, 2]


@pytest.mark.django_db
class TestTodayActionBox:
    def test_reports_membership_for_today(self, api_client, admin_user):
        from django.utils import timezone

        from apps.food.models import CycleStatus, FoodTeamCycle

        today = timezone.localdate()
        cycle = FoodTeamCycle.objects.create(
            name="Today",
            cooking_dates=[today.isoformat()],
            wish_deadline=timezone.now(),
            status=CycleStatus.FINALIZED,
            created_by=admin_user,
        )
        team = FoodTeam.objects.create(cycle=cycle, date=today)
        member = User.objects.create_user(email="m@example.com", password="x", first_name="M")
        FoodTeamMember.objects.create(team=team, user=member, house_number="3")

        api_client.force_authenticate(user=member)
        resp = api_client.get(reverse("food:team-today"))
        assert resp.status_code == 200
        assert resp.data["has_team_today"] is True
        assert resp.data["on_team"] is True
        assert len(resp.data["members"]) == 1

    def test_not_on_team_when_no_membership(self, api_client, user):
        api_client.force_authenticate(user=user)
        resp = api_client.get(reverse("food:team-today"))
        assert resp.status_code == 200
        assert resp.data["on_team"] is False


@pytest.mark.django_db
class TestLeftoversAndTakeawayBroadcastFiltering:
    """Notifications go only to people whose registration matches today's choice.

    Takeaway: house registered for take_away.
    Leftovers: house registered for take_away OR eat_in 17:30 (the 18:30 crowd
    sees leftovers in person).
    """

    def _setup(self, monday_date):
        from django.utils import timezone

        from apps.food.models import (
            CycleStatus,
            DiningOption,
            FoodTeam,
            FoodTeamCycle,
            MealRegistration,
            SeatingTime,
        )
        from apps.houses.models import House

        today = monday_date
        ha = House.objects.create(name="House A")
        hb = House.objects.create(name="House B")
        hc = House.objects.create(name="House C")
        ua = User.objects.create_user(email="ua@x", password="x", first_name="A", house=ha)
        ub = User.objects.create_user(email="ub@x", password="x", first_name="B", house=hb)
        uc = User.objects.create_user(email="uc@x", password="x", first_name="C", house=hc)
        actor = User.objects.create_user(
            email="actor@x", password="x", first_name="Cook", house=None
        )

        for h, opt, seat in [
            (ha, DiningOption.TAKE_AWAY, SeatingTime.FIRST),
            (hb, DiningOption.EAT_IN, SeatingTime.FIRST),
            (hc, DiningOption.EAT_IN, SeatingTime.SECOND),
        ]:
            MealRegistration.objects.create(
                house=h, date=today, adults_veg=1, dining_option=opt, seating_time=seat
            )

        cycle = FoodTeamCycle.objects.create(
            name="x",
            cooking_dates=[today.isoformat()],
            wish_deadline=timezone.now() + timedelta(days=1),
            status=CycleStatus.FINALIZED,
        )
        team = FoodTeam.objects.create(cycle=cycle, date=today)
        return team, actor, ua, ub, uc

    def test_takeaway_only_notifies_take_away_houses(self, monday_date):
        from apps.notifications.models import Notification, NotificationType
        from apps.notifications.tasks import broadcast_takeaway_ready

        team, actor, ua, ub, uc = self._setup(monday_date)
        broadcast_takeaway_ready(team.id, actor.id)

        notified = set(
            Notification.objects.filter(
                notification_type=NotificationType.FOOD_TEAM_TAKEAWAY_READY
            ).values_list("user_id", flat=True)
        )
        assert ua.id in notified
        assert ub.id not in notified
        assert uc.id not in notified

    def test_leftovers_notifies_takeaway_and_1730_houses(self, monday_date):
        from apps.notifications.models import Notification, NotificationType
        from apps.notifications.tasks import broadcast_leftovers_ready

        team, actor, ua, ub, uc = self._setup(monday_date)
        broadcast_leftovers_ready(team.id, actor.id, "", "Pasta i køleskabet")

        notified = set(
            Notification.objects.filter(
                notification_type=NotificationType.FOOD_TEAM_LEFTOVERS_READY
            ).values_list("user_id", flat=True)
        )
        assert ua.id in notified  # take-away
        assert ub.id in notified  # eat-in 17:30
        assert uc.id not in notified  # eat-in 18:30 — sees them in person


@pytest.mark.django_db
class TestUnavailableWishExcludesFromGeneration:
    def test_unavailable_user_not_placed(self, house, house2, admin_user, future_monday):
        from django.utils import timezone

        from apps.food.models import CycleStatus, FoodTeamCycle
        from apps.food.services.team_generator import generate_teams_for_cycle

        dates = [
            (future_monday + timedelta(days=i)).isoformat()
            for i in range(16)
            if (future_monday + timedelta(days=i)).weekday() <= 3
        ]
        cycle = FoodTeamCycle.objects.create(
            name="Unavail",
            cooking_dates=dates,
            wish_deadline=timezone.now() + timedelta(days=1),
            status=CycleStatus.COLLECTING_WISHES,
            created_by=admin_user,
        )
        users = [
            User.objects.create_user(
                email=f"u{i}@example.com",
                password="x",
                first_name=f"U{i}",
                house=house if i % 2 == 0 else house2,
            )
            for i in range(8)
        ]
        opted_out = users[0]
        FoodTeamWish.objects.create(
            cycle=cycle, user=opted_out, available_dates=[], is_unavailable=True
        )

        generate_teams_for_cycle(cycle, save=True)
        assert not FoodTeamMember.objects.filter(team__cycle=cycle, user=opted_out).exists()


@pytest.mark.django_db
class TestSwapDoubleBookingGuard:
    """A takeover deliberately leaves the taker on two teams in a cycle, so the
    swap paths must refuse a swap that would put someone on the same team twice.
    Without the guard this raised IntegrityError (500) on the unique
    (team, user) constraint mid-transaction."""

    def _people(self, house, house2):
        alice = User.objects.create_user(
            email="alice@guard.dk", password="x", first_name="Alice", house=house
        )
        bob = User.objects.create_user(
            email="bob@guard.dk", password="x", first_name="Bob", house=house2
        )
        return alice, bob

    def test_swap_request_rejected_when_requester_already_on_target_team(
        self, api_client, cycle_with_two_teams, house, house2
    ):
        _cycle, team1, team2, _d1, _d2 = cycle_with_two_teams
        alice, bob = self._people(house, house2)
        alice_on_1 = FoodTeamMember.objects.create(team=team1, user=alice, house_number="1")
        FoodTeamMember.objects.create(team=team2, user=alice, house_number="1")
        bob_on_2 = FoodTeamMember.objects.create(team=team2, user=bob, house_number="2")

        api_client.force_authenticate(user=alice)
        response = api_client.post(
            reverse("food:swap-request-list"),
            {
                "requester_membership_id": alice_on_1.id,
                "target_membership_id": bob_on_2.id,
            },
            format="json",
        )
        assert response.status_code == 400
        assert "allerede mad" in str(response.data)

    def test_swap_accept_rejected_when_state_changed_after_request(
        self, api_client, cycle_with_two_teams, house, house2
    ):
        """The request was legal when created; a takeover then put the requester
        on the target's team. Accepting must 400, not 500."""
        from apps.food.models import TeamSwapRequest

        _cycle, team1, team2, _d1, _d2 = cycle_with_two_teams
        alice, bob = self._people(house, house2)
        alice_on_1 = FoodTeamMember.objects.create(team=team1, user=alice, house_number="1")
        bob_on_2 = FoodTeamMember.objects.create(team=team2, user=bob, house_number="2")

        swap = TeamSwapRequest.objects.create(
            requester=alice,
            requester_membership=alice_on_1,
            target_membership=bob_on_2,
        )
        # Alice later also ends up on team2 (e.g. via a takeover).
        FoodTeamMember.objects.create(team=team2, user=alice, house_number="1")

        api_client.force_authenticate(user=bob)
        response = api_client.post(
            reverse("food:swap-request-respond", args=[swap.id]),
            {"action": "accept"},
            format="json",
        )
        assert response.status_code == 400
        assert "allerede mad" in str(response.data)

    def test_broadcast_accept_rejected_when_it_would_double_book(
        self, api_client, cycle_with_two_teams, house, house2
    ):
        _cycle, team1, team2, d1, _d2 = cycle_with_two_teams
        alice, bob = self._people(house, house2)
        alice_on_1 = FoodTeamMember.objects.create(team=team1, user=alice, house_number="1")
        FoodTeamMember.objects.create(team=team2, user=alice, house_number="1")
        bob_on_2 = FoodTeamMember.objects.create(team=team2, user=bob, house_number="2")

        broadcast = SwapBroadcast.objects.create(
            requester=bob,
            requester_membership=bob_on_2,
            available_dates=[d1.isoformat()],
            candidate_user_ids=[alice.id],
            status=BroadcastStatus.OPEN,
        )

        api_client.force_authenticate(user=alice)
        response = api_client.post(
            reverse("food:swap-broadcast-accept", args=[broadcast.id]),
            {"membership_id": alice_on_1.id},
            format="json",
        )
        assert response.status_code == 400
        assert "allerede mad" in str(response.data)

    def test_normal_swap_still_works(self, api_client, cycle_with_two_teams, house, house2):
        """Guard must not block the ordinary case."""
        from apps.food.models import TeamSwapRequest

        _cycle, team1, team2, _d1, _d2 = cycle_with_two_teams
        alice, bob = self._people(house, house2)
        alice_on_1 = FoodTeamMember.objects.create(team=team1, user=alice, house_number="1")
        bob_on_2 = FoodTeamMember.objects.create(team=team2, user=bob, house_number="2")

        api_client.force_authenticate(user=alice)
        create = api_client.post(
            reverse("food:swap-request-list"),
            {
                "requester_membership_id": alice_on_1.id,
                "target_membership_id": bob_on_2.id,
            },
            format="json",
        )
        assert create.status_code == 201

        swap = TeamSwapRequest.objects.latest("id")
        api_client.force_authenticate(user=bob)
        accept = api_client.post(
            reverse("food:swap-request-respond", args=[swap.id]),
            {"action": "accept"},
            format="json",
        )
        assert accept.status_code == 200
        alice_on_1.refresh_from_db()
        bob_on_2.refresh_from_db()
        assert alice_on_1.user == bob
        assert bob_on_2.user == alice
