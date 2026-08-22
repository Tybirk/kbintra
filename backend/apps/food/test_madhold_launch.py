"""Tests for the madhold launch features: takeover/favours, broadcast swaps,
self-service profile, today action box, and per-cycle unavailability."""

from datetime import timedelta
from io import BytesIO
from unittest.mock import patch

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
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

    def _extra_takeaway_house(self, team, label):
        """A house registered for take-away, plus its (non-cooking) resident."""
        from apps.food.models import DiningOption, MealRegistration, SeatingTime
        from apps.houses.models import House

        house = House.objects.create(name=f"House {label}")
        resident = User.objects.create_user(
            email=f"{label.lower()}@x", password="x", first_name=label, house=house
        )
        MealRegistration.objects.create(
            house=house,
            date=team.date,
            adults_veg=1,
            dining_option=DiningOption.TAKE_AWAY,
            seating_time=SeatingTime.FIRST,
        )
        return resident

    def test_takeaway_excludes_todays_cooking_team(self, monday_date):
        """The cooks are standing next to the food — no push about their own meal."""
        from apps.notifications.models import Notification, NotificationType
        from apps.notifications.tasks import broadcast_takeaway_ready

        team, actor, ua, _ub, _uc = self._setup(monday_date)
        # ua's house ordered take-away, but ua is on today's team.
        FoodTeamMember.objects.create(team=team, user=ua, house_number="1")
        outsider = self._extra_takeaway_house(team, "D")

        broadcast_takeaway_ready(team.id, actor.id)

        notified = set(
            Notification.objects.filter(
                notification_type=NotificationType.FOOD_TEAM_TAKEAWAY_READY
            ).values_list("user_id", flat=True)
        )
        assert outsider.id in notified
        assert ua.id not in notified

    def test_leftovers_excludes_todays_cooking_team(self, monday_date):
        from apps.notifications.models import Notification, NotificationType
        from apps.notifications.tasks import broadcast_leftovers_ready

        team, actor, ua, ub, _uc = self._setup(monday_date)
        # ub's house eats in at 17:30, but ub is on today's team.
        FoodTeamMember.objects.create(team=team, user=ub, house_number="2")

        broadcast_leftovers_ready(team.id, actor.id, "", "")

        notified = set(
            Notification.objects.filter(
                notification_type=NotificationType.FOOD_TEAM_LEFTOVERS_READY
            ).values_list("user_id", flat=True)
        )
        assert ua.id in notified
        assert ub.id not in notified


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


@pytest.mark.django_db
class TestCycleResetTeams:
    """`cycles/<id>/reset-teams/` undoes a finalized cycle so it can be regenerated.

    Generation refuses to run on a FINALIZED cycle, and nothing in the app
    could delete the teams — the only escape was the Django admin.
    """

    def _finalize(self, cycle):
        from apps.food.models import CycleStatus

        cycle.status = CycleStatus.FINALIZED
        cycle.save(update_fields=["status"])

    def _populate(self, cycle, team1, team2, d1, house, house2, suffix="a"):
        """Two members plus the swap/broadcast/favour rows hanging off them."""
        from apps.food.models import TeamSwapRequest

        alice = User.objects.create_user(
            email=f"alice-{suffix}@reset.dk", password="x", first_name="Alice", house=house
        )
        bob = User.objects.create_user(
            email=f"bob-{suffix}@reset.dk", password="x", first_name="Bob", house=house2
        )
        m1 = FoodTeamMember.objects.create(team=team1, user=alice, house_number="1")
        m2 = FoodTeamMember.objects.create(team=team2, user=bob, house_number="2")
        TeamSwapRequest.objects.create(
            requester=alice, requester_membership=m1, target_membership=m2
        )
        SwapBroadcast.objects.create(
            requester=alice,
            requester_membership=m1,
            available_dates=[team2.date.isoformat()],
        )
        TeamFavour.objects.create(creditor=alice, debtor=bob, cycle=cycle, origin_date=d1)
        return alice, bob

    def test_reset_deletes_teams_and_reopens_cycle(
        self, api_client, admin_user, house, house2, cycle_with_two_teams
    ):
        from apps.food.models import CycleStatus, TeamSwapRequest

        cycle, team1, team2, d1, _d2 = cycle_with_two_teams
        self._finalize(cycle)
        self._populate(cycle, team1, team2, d1, house, house2)

        api_client.force_authenticate(user=admin_user)
        resp = api_client.post(reverse("food:cycle-reset-teams", args=[cycle.id]))

        assert resp.status_code == 200, resp.data
        assert resp.data["status"] == CycleStatus.COLLECTING_WISHES
        assert resp.data["deleted"] == {
            "teams": 2,
            "memberships": 2,
            "pending_swap_requests": 1,
            "open_broadcasts": 1,
            "favours": 1,
        }

        cycle.refresh_from_db()
        assert cycle.status == CycleStatus.COLLECTING_WISHES
        assert not FoodTeam.objects.filter(cycle=cycle).exists()
        assert not FoodTeamMember.objects.exists()
        assert not TeamSwapRequest.objects.exists()
        assert not SwapBroadcast.objects.exists()
        assert not TeamFavour.objects.exists()

    def test_preview_reports_what_will_be_deleted(
        self, api_client, admin_user, house, house2, cycle_with_two_teams
    ):
        cycle, team1, team2, d1, _d2 = cycle_with_two_teams
        self._finalize(cycle)
        self._populate(cycle, team1, team2, d1, house, house2, suffix="preview")

        api_client.force_authenticate(user=admin_user)
        resp = api_client.get(reverse("food:cycle-reset-teams", args=[cycle.id]))

        assert resp.status_code == 200, resp.data
        assert resp.data["teams"] == 2
        assert resp.data["memberships"] == 2
        assert resp.data["pending_swap_requests"] == 1
        assert resp.data["open_broadcasts"] == 1
        assert resp.data["favours"] == 1
        assert resp.data["has_past_dates"] is False
        assert resp.data["past_dates"] == []
        # Nothing was destroyed by looking.
        assert FoodTeam.objects.filter(cycle=cycle).count() == 2

    def test_refused_when_a_cooking_date_has_passed(self, api_client, admin_user, house):
        """People have already cooked — deleting the teams would erase history."""
        from django.utils import timezone

        from apps.food.models import CycleStatus, FoodTeamCycle

        yesterday = timezone.localdate() - timedelta(days=1)
        tomorrow = timezone.localdate() + timedelta(days=1)
        cycle = FoodTeamCycle.objects.create(
            name="Igangværende",
            cooking_dates=[yesterday.isoformat(), tomorrow.isoformat()],
            wish_deadline=timezone.now() - timedelta(days=2),
            status=CycleStatus.FINALIZED,
            created_by=admin_user,
        )
        old_team = FoodTeam.objects.create(cycle=cycle, date=yesterday)
        FoodTeam.objects.create(cycle=cycle, date=tomorrow)
        cook = User.objects.create_user(
            email="cook@reset.dk", password="x", first_name="Cook", house=house
        )
        FoodTeamMember.objects.create(team=old_team, user=cook, house_number="1")

        api_client.force_authenticate(user=admin_user)
        resp = api_client.post(reverse("food:cycle-reset-teams", args=[cycle.id]))

        assert resp.status_code == 400, resp.data
        assert "passeret" in resp.data["detail"]
        cycle.refresh_from_db()
        assert cycle.status == CycleStatus.FINALIZED
        assert FoodTeam.objects.filter(cycle=cycle).count() == 2
        assert FoodTeamMember.objects.filter(team=old_team).exists()

        # The preview flags it too, so the UI can block the button.
        preview = api_client.get(reverse("food:cycle-reset-teams", args=[cycle.id]))
        assert preview.data["has_past_dates"] is True
        assert yesterday.isoformat() in preview.data["past_dates"]

    def test_non_food_admin_is_forbidden(self, api_client, user, cycle_with_two_teams):
        cycle, _team1, _team2, _d1, _d2 = cycle_with_two_teams
        self._finalize(cycle)

        api_client.force_authenticate(user=user)
        assert api_client.get(reverse("food:cycle-reset-teams", args=[cycle.id])).status_code == 403
        assert (
            api_client.post(reverse("food:cycle-reset-teams", args=[cycle.id])).status_code == 403
        )
        assert FoodTeam.objects.filter(cycle=cycle).count() == 2

    def test_food_admin_without_staff_is_allowed(self, api_client, cycle_with_two_teams):
        cycle, _team1, _team2, _d1, _d2 = cycle_with_two_teams
        self._finalize(cycle)
        food_admin = User.objects.create_user(
            email="madadmin@reset.dk", password="x", first_name="Mad", is_food_admin=True
        )

        api_client.force_authenticate(user=food_admin)
        resp = api_client.post(reverse("food:cycle-reset-teams", args=[cycle.id]))
        assert resp.status_code == 200, resp.data

    def test_regeneration_works_after_reset(
        self, api_client, admin_user, house, house2, future_monday
    ):
        from django.utils import timezone

        from apps.food.models import CycleStatus, FoodTeamCycle

        dates = [
            (future_monday + timedelta(days=i)).isoformat()
            for i in range(16)
            if (future_monday + timedelta(days=i)).weekday() <= 3
        ]
        cycle = FoodTeamCycle.objects.create(
            name="Regenerering",
            cooking_dates=dates,
            wish_deadline=timezone.now() + timedelta(days=1),
            status=CycleStatus.COLLECTING_WISHES,
            created_by=admin_user,
        )
        for i in range(8):
            User.objects.create_user(
                email=f"cook{i}@regen.dk",
                password="x",
                first_name=f"Cook{i}",
                house=house if i % 2 == 0 else house2,
            )

        api_client.force_authenticate(user=admin_user)
        first = api_client.post(
            reverse("food:generate-teams"), {"cycle_id": cycle.id}, format="json"
        )
        assert first.status_code == 200, first.data
        cycle.refresh_from_db()
        assert cycle.status == CycleStatus.FINALIZED
        assert FoodTeam.objects.filter(cycle=cycle).exists()

        # Without a reset the admin is stuck: generation refuses a finalized cycle.
        blocked = api_client.post(
            reverse("food:generate-teams"), {"cycle_id": cycle.id}, format="json"
        )
        assert blocked.status_code == 400

        reset = api_client.post(reverse("food:cycle-reset-teams", args=[cycle.id]))
        assert reset.status_code == 200, reset.data
        cycle.refresh_from_db()
        assert cycle.status == CycleStatus.COLLECTING_WISHES
        assert not FoodTeam.objects.filter(cycle=cycle).exists()

        again = api_client.post(
            reverse("food:generate-teams"), {"cycle_id": cycle.id}, format="json"
        )
        assert again.status_code == 200, again.data
        cycle.refresh_from_db()
        assert cycle.status == CycleStatus.FINALIZED
        assert FoodTeam.objects.filter(cycle=cycle).exists()


@pytest.fixture
def todays_team(db, admin_user):
    """A finalized team cooking *today*, with one member (the announcer)."""
    from django.utils import timezone

    from apps.food.models import CycleStatus, FoodTeamCycle

    today = timezone.localdate()
    cycle = FoodTeamCycle.objects.create(
        name="I dag",
        cooking_dates=[today.isoformat()],
        wish_deadline=timezone.now(),
        status=CycleStatus.FINALIZED,
        created_by=admin_user,
    )
    team = FoodTeam.objects.create(cycle=cycle, date=today)
    cook = User.objects.create_user(email="cook@example.com", password="x", first_name="Kok")
    FoodTeamMember.objects.create(team=team, user=cook, house_number="7")
    return team, cook


@pytest.mark.django_db
class TestAnnouncementSentOnce:
    """Each announcement fans out to ~90 people, so it must fire exactly once.

    The guard has to be a synchronous write on the team row: the broadcast is a
    Huey task (async in production), and create_notification honours per-user
    preferences, so counting Notification rows can never be trusted.
    """

    def test_second_takeaway_press_does_not_enqueue_second_broadcast(self, api_client, todays_team):
        team, cook = todays_team
        api_client.force_authenticate(user=cook)
        url = reverse("food:team-notify-takeaway", kwargs={"pk": team.id})

        with patch("apps.notifications.tasks.broadcast_takeaway_ready") as broadcast:
            first = api_client.post(url)
            second = api_client.post(url)

        assert first.status_code == 200, first.data
        assert first.data["sent"] is True
        assert second.status_code == 200
        assert second.data["sent"] is False
        assert broadcast.call_count == 1

        team.refresh_from_db()
        assert team.takeaway_announced_at is not None

    def test_takeaway_guard_holds_even_when_nobody_gets_a_notification(
        self, api_client, todays_team
    ):
        """No Notification rows exist (nobody ordered take-away) — still once."""
        from apps.notifications.models import Notification

        team, cook = todays_team
        api_client.force_authenticate(user=cook)
        url = reverse("food:team-notify-takeaway", kwargs={"pk": team.id})

        assert api_client.post(url).data["sent"] is True
        assert Notification.objects.count() == 0
        assert api_client.post(url).data["sent"] is False

    def test_second_leftovers_press_does_not_enqueue_second_broadcast(
        self, api_client, todays_team
    ):
        team, cook = todays_team
        api_client.force_authenticate(user=cook)
        url = reverse("food:team-notify-leftovers", kwargs={"pk": team.id})

        with patch("apps.notifications.tasks.broadcast_leftovers_ready") as broadcast:
            first = api_client.post(url, {"message": "Lasagne"}, format="multipart")
            second = api_client.post(url, {"message": "Lasagne igen"}, format="multipart")

        assert first.data["sent"] is True
        assert second.data["sent"] is False
        assert broadcast.call_count == 1

        team.refresh_from_db()
        assert team.leftovers_message == "Lasagne"

    def test_action_box_reports_already_sent_state(self, api_client, todays_team):
        team, cook = todays_team
        api_client.force_authenticate(user=cook)

        before = api_client.get(reverse("food:team-today"))
        assert before.data["takeaway_sent"] is False
        assert before.data["leftovers_sent"] is False

        with patch("apps.notifications.tasks.broadcast_takeaway_ready"):
            api_client.post(reverse("food:team-notify-takeaway", kwargs={"pk": team.id}))

        after = api_client.get(reverse("food:team-today"))
        assert after.data["takeaway_sent"] is True
        assert after.data["leftovers_sent"] is False


def _heic_photo(width: int = 3000, height: int = 2000) -> bytes:
    """A real HEIC image — what an iPhone camera actually uploads."""
    from PIL import Image
    from pillow_heif import register_heif_opener

    register_heif_opener()
    img = Image.new("RGB", (width, height), (200, 120, 40))
    buf = BytesIO()
    img.save(buf, format="HEIF")
    return buf.getvalue()


@pytest.mark.django_db
class TestLeftoversImageHandling:
    """The photo must be web-safe on disk and reachable from an email client."""

    def _post_photo(self, api_client, team, upload):
        url = reverse("food:team-notify-leftovers", kwargs={"pk": team.id})
        with patch("apps.notifications.tasks.broadcast_leftovers_ready") as broadcast:
            resp = api_client.post(url, {"message": "Rester", "image": upload}, format="multipart")
        return resp, broadcast

    def test_heic_photo_is_converted_to_a_bounded_jpeg(
        self, api_client, todays_team, settings, tmp_path
    ):
        from pathlib import Path

        from PIL import Image

        settings.MEDIA_ROOT = str(tmp_path)
        team, cook = todays_team
        api_client.force_authenticate(user=cook)

        upload = SimpleUploadedFile("IMG_4711.HEIC", _heic_photo(), content_type="image/heic")
        resp, _broadcast = self._post_photo(api_client, team, upload)
        assert resp.status_code == 200, resp.data

        team.refresh_from_db()
        assert team.leftovers_image_url.endswith(".jpg")

        stored = list((Path(tmp_path) / "food_leftovers").glob("*"))
        assert len(stored) == 1
        # Chrome/Firefox can't render HEIC, so what we keep must be a JPEG —
        # and not a 12-megapixel one.
        with Image.open(stored[0]) as img:
            assert img.format == "JPEG"
            assert max(img.size) <= 2000

    def test_email_image_url_is_signed_so_a_mail_client_can_load_it(
        self, api_client, todays_team, settings, tmp_path
    ):
        from django.test import Client

        settings.MEDIA_ROOT = str(tmp_path)
        team, cook = todays_team
        api_client.force_authenticate(user=cook)

        upload = SimpleUploadedFile("rester.jpg", _heic_photo(400, 300), content_type="image/jpeg")
        resp, broadcast = self._post_photo(api_client, team, upload)
        assert resp.status_code == 200, resp.data

        email_image_url = broadcast.call_args[0][2]
        assert email_image_url.startswith(settings.SITE_URL)
        assert "sig=" in email_image_url and "exp=" in email_image_url

        # An email client sends no JWT and no session cookie. The signed URL is
        # the whole point: this request must still return the photo.
        path_with_query = email_image_url[len(settings.SITE_URL) :]
        anonymous = Client()
        media_resp = anonymous.get(path_with_query)
        assert media_resp.status_code == 200

        # The same path without the signature stays gated.
        assert anonymous.get(path_with_query.split("?")[0]).status_code == 401

    def test_non_image_upload_is_rejected_without_announcing(
        self, api_client, todays_team, settings, tmp_path
    ):
        settings.MEDIA_ROOT = str(tmp_path)
        team, cook = todays_team
        api_client.force_authenticate(user=cook)

        upload = SimpleUploadedFile("menu.pdf", b"%PDF-1.4 not a photo", "application/pdf")
        resp, broadcast = self._post_photo(api_client, team, upload)

        assert resp.status_code == 400
        assert broadcast.call_count == 0
        team.refresh_from_db()
        # Nothing was claimed, so the team can retry (with or without a photo).
        assert team.leftovers_announced_at is None


@pytest.mark.django_db
class TestLeftoversImageIsSignedForReaders:
    """/mad/rester renders the photo with a plain <img>, and /media is
    auth-gated, so the URL the API hands out has to carry a signature like
    every other media URL in the app."""

    def test_today_leftovers_image_url_is_signed(self, api_client, user, future_monday):
        from django.utils import timezone

        from apps.food.models import FoodTeam

        team = FoodTeam.objects.create(date=timezone.localdate())
        team.leftovers_message = "Der er lasagne tilbage"
        team.leftovers_image_url = "http://testserver/media/food_leftovers/x.jpg"
        team.leftovers_announced_at = timezone.now()
        team.save()

        api_client.force_authenticate(user=user)
        response = api_client.get(reverse("food:leftovers-today"))

        assert response.status_code == 200
        assert response.data["has_leftovers"] is True
        url = response.data["image_url"]
        assert "exp=" in url and "sig=" in url, url

    def test_no_image_stays_empty(self, api_client, user):
        from django.utils import timezone

        from apps.food.models import FoodTeam

        team = FoodTeam.objects.create(date=timezone.localdate())
        team.leftovers_message = "Ingen billede i dag"
        team.leftovers_announced_at = timezone.now()
        team.save()

        api_client.force_authenticate(user=user)
        response = api_client.get(reverse("food:leftovers-today"))

        assert response.status_code == 200
        assert response.data["image_url"] == ""


# =============================================================================
# Generator: hard failure instead of a quietly wrong schedule
# =============================================================================


@pytest.fixture
def two_cooking_dates(db, admin_user, future_monday):
    """A cycle over two cooking days, still collecting wishes."""
    from django.utils import timezone

    from apps.food.models import CycleStatus, FoodTeamCycle

    d1 = future_monday
    d2 = future_monday + timedelta(days=1)
    cycle = FoodTeamCycle.objects.create(
        name="Generator Test Cycle",
        cooking_dates=[d1.isoformat(), d2.isoformat()],
        wish_deadline=timezone.now() + timedelta(days=7),
        status=CycleStatus.COLLECTING_WISHES,
        created_by=admin_user,
    )
    return cycle, d1, d2


def _cooks_in_own_houses(count: int, start: int = 0):
    """Create ``count`` cooks, each alone in their own house (no collisions)."""
    from apps.houses.models import House

    users = []
    for i in range(start, start + count):
        house = House.objects.create(name=f"Gen House {i}", address=f"{i} Test Vej")
        users.append(
            User.objects.create_user(
                email=f"gencook{i}@example.com",
                password="x",
                first_name=f"Kok{i}",
                house=house,
                can_be_head_chef=(i % 3 == 0),
            )
        )
    return users


@pytest.mark.django_db
class TestGeneratorRefusesBadSchedules:
    def test_housemate_wish_without_a_partner_stops_generation(self, two_cooking_dates):
        """A lone 'cook with my housemate' flag is a data error, not a schedule."""
        from apps.food.models import CycleStatus, FoodTeam
        from apps.food.services.team_generator import TeamGenerator

        cycle, _d1, _d2 = two_cooking_dates
        cooks = _cooks_in_own_houses(12)
        lonely = cooks[0]
        lonely.prefers_cooking_with_housemate = True
        lonely.save()

        result = TeamGenerator(cycle).generate(save=True)

        assert result.success is False
        assert lonely.first_name in result.message
        # Nothing was written, and the cycle is still open for wishes.
        assert FoodTeam.objects.filter(cycle=cycle).count() == 0
        cycle.refresh_from_db()
        assert cycle.status == CycleStatus.COLLECTING_WISHES

    def test_couple_without_a_shared_date_stops_generation(self, two_cooking_dates):
        from apps.food.models import FoodTeam
        from apps.food.services.team_generator import TeamGenerator
        from apps.houses.models import House

        cycle, d1, d2 = two_cooking_dates
        _cooks_in_own_houses(12)

        shared = House.objects.create(name="Delt hus", address="1 Delt Vej")
        partners = []
        for i, d in enumerate((d1, d2)):
            user = User.objects.create_user(
                email=f"partner{i}@example.com",
                password="x",
                first_name=f"Partner{i}",
                house=shared,
                prefers_cooking_with_housemate=True,
            )
            # Each partner is free only on the day the other one cannot cook.
            FoodTeamWish.objects.create(cycle=cycle, user=user, available_dates=[d.isoformat()])
            partners.append(user)

        result = TeamGenerator(cycle).generate(save=True)

        assert result.success is False
        assert partners[0].first_name in result.message
        assert partners[1].first_name in result.message
        assert FoodTeam.objects.filter(cycle=cycle).count() == 0

    def test_the_relaxation_flag_schedules_such_a_couple_singly(self, two_cooking_dates):
        """The admin can still force a schedule through, and is told what gave."""
        from apps.food.models import FoodTeam
        from apps.food.services.team_generator import TeamGenerator
        from apps.houses.models import House

        cycle, d1, d2 = two_cooking_dates
        _cooks_in_own_houses(12)

        shared = House.objects.create(name="Delt hus", address="1 Delt Vej")
        for i, d in enumerate((d1, d2)):
            user = User.objects.create_user(
                email=f"relaxed{i}@example.com",
                password="x",
                first_name=f"Fri{i}",
                house=shared,
                prefers_cooking_with_housemate=True,
            )
            FoodTeamWish.objects.create(cycle=cycle, user=user, available_dates=[d.isoformat()])

        result = TeamGenerator(cycle, allow_couples_without_common_dates=True).generate(save=True)

        assert FoodTeam.objects.filter(cycle=cycle).count() > 0
        assert any("hver for sig" in w for w in result.warnings)


@pytest.mark.django_db
class TestBalanceTeamSizes:
    def test_a_surplus_day_hands_one_cook_to_a_short_day(self, two_cooking_dates):
        """A 7/5 split is evened to 6/6 by moving someone who wished for both."""
        from apps.food.services.team_generator import TeamGenerator

        cycle, d1, d2 = two_cooking_dates
        cooks = _cooks_in_own_houses(12)

        generator = TeamGenerator(cycle)
        generator.load_data()

        # Hand-build the lopsided state the placement passes can leave behind.
        for user in cooks[:7]:
            generator.assign_person(user.id, d1)
        for user in cooks[7:]:
            generator.assign_person(user.id, d2)
        assert len(generator.date_to_persons[d1]) == 7
        assert len(generator.date_to_persons[d2]) == 5

        generator.balance_team_sizes()

        assert len(generator.date_to_persons[d1]) == 6
        assert len(generator.date_to_persons[d2]) == 6

    def test_it_leaves_a_schedule_alone_when_no_one_can_move(self, two_cooking_dates):
        """Nobody on the full day wished for the short day, so nothing is forced."""
        from apps.food.services.team_generator import TeamGenerator

        cycle, d1, d2 = two_cooking_dates
        cooks = _cooks_in_own_houses(12)

        # The seven on d1 can only cook d1, so the surplus has nowhere to go.
        for user in cooks[:7]:
            FoodTeamWish.objects.create(cycle=cycle, user=user, available_dates=[d1.isoformat()])

        generator = TeamGenerator(cycle)
        generator.load_data()
        for user in cooks[:7]:
            generator.assign_person(user.id, d1)
        for user in cooks[7:]:
            generator.assign_person(user.id, d2)

        generator.balance_team_sizes()

        assert len(generator.date_to_persons[d1]) == 7
        assert len(generator.date_to_persons[d2]) == 5
        assert any("udjævne" in w for w in generator.warnings)


# =============================================================================
# Takeover as repayment: working a favour off instead of minting a new one
# =============================================================================


@pytest.mark.django_db
class TestTakeoverSettlesADebt:
    def _owe(self, debtor, creditor, cycle, origin):
        return TeamFavour.objects.create(
            creditor=creditor, debtor=debtor, cycle=cycle, origin_date=origin
        )

    def test_taking_a_day_from_someone_you_owe_clears_the_debt(
        self, api_client, house, house2, cycle_with_two_teams
    ):
        cycle, team1, team2, d1, _d2 = cycle_with_two_teams
        me = User.objects.create_user(
            email="debtor@example.com", password="x", first_name="Skyldner", house=house
        )
        them = User.objects.create_user(
            email="creditor@example.com", password="x", first_name="Kreditor", house=house2
        )
        their_shift = FoodTeamMember.objects.create(team=team1, user=them, house_number="2")
        favour = self._owe(me, them, cycle, d1)

        api_client.force_authenticate(user=me)
        response = api_client.post(
            reverse("food:team-takeover"),
            {"target_membership_id": their_shift.id, "settle_favour_id": favour.id},
            format="json",
        )

        assert response.status_code == 201, response.data
        favour.refresh_from_db()
        assert favour.settled is True
        assert favour.settled_at is not None
        # The shift moved, and no new debt was created in the taker's name.
        their_shift.refresh_from_db()
        assert their_shift.user_id == me.id
        assert TeamFavour.objects.filter(creditor=me).count() == 0

    def test_a_plain_takeover_still_creates_a_favour(
        self, api_client, house, house2, cycle_with_two_teams
    ):
        _cycle, team1, _team2, _d1, _d2 = cycle_with_two_teams
        me = User.objects.create_user(
            email="taker@example.com", password="x", first_name="Tager", house=house
        )
        them = User.objects.create_user(
            email="freed@example.com", password="x", first_name="Fritaget", house=house2
        )
        their_shift = FoodTeamMember.objects.create(team=team1, user=them, house_number="2")

        api_client.force_authenticate(user=me)
        response = api_client.post(
            reverse("food:team-takeover"), {"target_membership_id": their_shift.id}, format="json"
        )

        assert response.status_code == 201
        assert TeamFavour.objects.filter(creditor=me, debtor=them, settled=False).count() == 1

    def test_you_cannot_settle_a_debt_against_the_wrong_person(
        self, api_client, house, house2, cycle_with_two_teams
    ):
        """Cooking for Anna does not clear what you owe Bo."""
        cycle, team1, _team2, d1, _d2 = cycle_with_two_teams
        me = User.objects.create_user(
            email="me2@example.com", password="x", first_name="Mig", house=house
        )
        anna = User.objects.create_user(
            email="anna@example.com", password="x", first_name="Anna", house=house2
        )
        bo = User.objects.create_user(
            email="bo@example.com", password="x", first_name="Bo", house=house2
        )
        annas_shift = FoodTeamMember.objects.create(team=team1, user=anna, house_number="2")
        owed_to_bo = self._owe(me, bo, cycle, d1)

        api_client.force_authenticate(user=me)
        response = api_client.post(
            reverse("food:team-takeover"),
            {"target_membership_id": annas_shift.id, "settle_favour_id": owed_to_bo.id},
            format="json",
        )

        assert response.status_code == 400
        owed_to_bo.refresh_from_db()
        assert owed_to_bo.settled is False
        # The shift must not have moved either.
        annas_shift.refresh_from_db()
        assert annas_shift.user_id == anna.id

    def test_you_cannot_settle_a_debt_that_is_not_yours(
        self, api_client, house, house2, cycle_with_two_teams
    ):
        cycle, team1, _team2, d1, _d2 = cycle_with_two_teams
        me = User.objects.create_user(
            email="bystander@example.com", password="x", first_name="Tilskuer", house=house
        )
        them = User.objects.create_user(
            email="owed@example.com", password="x", first_name="Ejer", house=house2
        )
        other = User.objects.create_user(
            email="other@example.com", password="x", first_name="Anden", house=house
        )
        their_shift = FoodTeamMember.objects.create(team=team1, user=them, house_number="2")
        someone_elses_debt = self._owe(other, them, cycle, d1)

        api_client.force_authenticate(user=me)
        response = api_client.post(
            reverse("food:team-takeover"),
            {"target_membership_id": their_shift.id, "settle_favour_id": someone_elses_debt.id},
            format="json",
        )

        assert response.status_code == 400
        someone_elses_debt.refresh_from_db()
        assert someone_elses_debt.settled is False


@pytest.mark.django_db
class TestFavourRepayOptions:
    def test_it_lists_the_creditors_upcoming_days(
        self, api_client, house, house2, cycle_with_two_teams
    ):
        cycle, team1, team2, d1, d2 = cycle_with_two_teams
        me = User.objects.create_user(
            email="owes@example.com", password="x", first_name="Skylder", house=house
        )
        them = User.objects.create_user(
            email="isowed@example.com", password="x", first_name="Tilgode", house=house2
        )
        FoodTeamMember.objects.create(team=team1, user=them, house_number="2")
        FoodTeamMember.objects.create(team=team2, user=them, house_number="2")
        # A day I already cook is not an option — it would double-book me.
        FoodTeamMember.objects.create(team=team2, user=me, house_number="1")
        favour = TeamFavour.objects.create(creditor=them, debtor=me, cycle=cycle, origin_date=d1)

        api_client.force_authenticate(user=me)
        response = api_client.get(reverse("food:favour-repay-options", kwargs={"pk": favour.id}))

        assert response.status_code == 200
        assert [row["date"] for row in response.data] == [d1]

    def test_only_the_debtor_may_ask(self, api_client, house, house2, cycle_with_two_teams):
        cycle, _team1, _team2, d1, _d2 = cycle_with_two_teams
        me = User.objects.create_user(
            email="nosy@example.com", password="x", first_name="Nysgerrig", house=house
        )
        a = User.objects.create_user(
            email="a2@example.com", password="x", first_name="A", house=house2
        )
        b = User.objects.create_user(
            email="b2@example.com", password="x", first_name="B", house=house2
        )
        favour = TeamFavour.objects.create(creditor=a, debtor=b, cycle=cycle, origin_date=d1)

        api_client.force_authenticate(user=me)
        response = api_client.get(reverse("food:favour-repay-options", kwargs={"pk": favour.id}))

        assert response.status_code == 403


# =============================================================================
# Food-admin roster: who is sitting out, and why
# =============================================================================


@pytest.mark.django_db
class TestFoodRoster:
    def _admin(self, house):
        return User.objects.create_user(
            email="foodadmin@example.com",
            password="x",
            first_name="Madadmin",
            house=house,
            is_food_admin=True,
        )

    def test_it_reports_both_kinds_of_sitting_out_with_their_reasons(
        self, api_client, house, house2, two_cooking_dates
    ):
        cycle, d1, _d2 = two_cooking_dates
        admin = self._admin(house)

        paused = User.objects.create_user(
            email="paused@example.com",
            password="x",
            first_name="Pauset",
            house=house2,
            is_exempt_from_food_teams=True,
            food_team_pause_reason="Væk til foråret",
        )
        this_period = User.objects.create_user(
            email="thisperiod@example.com", password="x", first_name="Denne", house=house2
        )
        this_period.food_team_pause_reason = "Rejser i september"
        this_period.save(update_fields=["food_team_pause_reason"])
        FoodTeamWish.objects.create(
            cycle=cycle, user=this_period, available_dates=[], is_unavailable=True
        )

        api_client.force_authenticate(user=admin)
        response = api_client.get(reverse("food:food-roster"))

        assert response.status_code == 200
        assert response.data["cycle"]["name"] == cycle.name
        rows = {r["id"]: r for r in response.data["residents"]}

        # Standing pause: flagged on the person, with its own reason.
        assert rows[paused.id]["is_exempt_from_food_teams"] is True
        assert rows[paused.id]["food_team_pause_reason"] == "Væk til foråret"
        assert rows[paused.id]["is_unavailable_this_cycle"] is False

        # Sitting out this period only: comes from the wish, and is kept distinct.
        assert rows[this_period.id]["is_exempt_from_food_teams"] is False
        assert rows[this_period.id]["is_unavailable_this_cycle"] is True
        assert rows[this_period.id]["food_team_pause_reason"] == "Rejser i september"

        # Someone who simply hasn't answered yet is neither.
        assert rows[admin.id]["has_submitted_wish"] is False
        assert rows[admin.id]["is_unavailable_this_cycle"] is False

    def test_it_shows_the_bare_house_number(self, api_client, house, two_cooking_dates):
        from apps.houses.models import House

        admin = self._admin(house)
        resident = User.objects.create_user(
            email="numbered@example.com",
            password="x",
            first_name="Nummer",
            house=House.objects.create(name="Kløverbakkevej 45"),
        )

        api_client.force_authenticate(user=admin)
        response = api_client.get(reverse("food:food-roster"))

        row = next(r for r in response.data["residents"] if r["id"] == resident.id)
        assert row["house_number"] == "45"

    def test_it_is_closed_to_everyone_else(self, api_client, house, two_cooking_dates):
        ordinary = User.objects.create_user(
            email="ordinary@example.com", password="x", first_name="Almindelig", house=house
        )

        api_client.force_authenticate(user=ordinary)
        response = api_client.get(reverse("food:food-roster"))

        assert response.status_code == 403
