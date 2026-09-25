"""Tests for the madhold notifications that used to be missing entirely.

Every case here is the same shape: the app changes who cooks, or is about to,
and somebody has to be told. Before these fixes a 1:1 bytte, its answer, a whole
generated plan and the opening of a period all happened in silence, and a
takeover borrowed the bytteanmodning's wording and its opt-out toggle.
"""

from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.food.models import (
    BroadcastStatus,
    CycleStatus,
    FoodTeam,
    FoodTeamCycle,
    FoodTeamMember,
    FoodTeamWish,
    SwapBroadcast,
    TeamFavour,
    TeamSwapRequest,
)
from apps.notifications.models import Notification, NotificationType
from apps.users.models import User


@pytest.fixture
def future_monday():
    """A Monday safely in the future so date >= today checks pass."""
    base = timezone.localdate() + timedelta(weeks=130)
    return base + timedelta(days=(7 - base.weekday()) % 7)


@pytest.fixture
def two_teams(db, future_monday):
    """A finalized cycle with teams on two consecutive cooking days."""
    d1 = future_monday
    d2 = future_monday + timedelta(days=1)
    cycle = FoodTeamCycle.objects.create(
        name="Madhold test-periode",
        cooking_dates=[d1.isoformat(), d2.isoformat()],
        wish_deadline=timezone.now() + timedelta(days=7),
        status=CycleStatus.COLLECTING_WISHES,
    )
    return (
        cycle,
        FoodTeam.objects.create(cycle=cycle, date=d1),
        FoodTeam.objects.create(cycle=cycle, date=d2),
        d1,
        d2,
    )


@pytest.fixture
def alice_and_bob(db, house, house2):
    alice = User.objects.create_user(
        email="alice@notif.dk", password="x", first_name="Alice", house=house
    )
    bob = User.objects.create_user(
        email="bob@notif.dk", password="x", first_name="Bob", house=house2
    )
    return alice, bob


def _notifications_for(user, notification_type=None):
    qs = Notification.objects.filter(user=user)
    if notification_type:
        qs = qs.filter(notification_type=notification_type)
    return list(qs)


@pytest.mark.django_db
class TestDirectSwapRequestNotifies:
    """A 1:1 bytte needs the target's answer, so it has to reach them."""

    def test_target_is_told_and_both_dates_are_named(self, api_client, two_teams, alice_and_bob):
        _cycle, team1, team2, d1, d2 = two_teams
        alice, bob = alice_and_bob
        alice_on_1 = FoodTeamMember.objects.create(team=team1, user=alice, house_number="1")
        bob_on_2 = FoodTeamMember.objects.create(team=team2, user=bob, house_number="2")

        api_client.force_authenticate(user=alice)
        response = api_client.post(
            reverse("food:swap-request-list"),
            {
                "requester_membership_id": alice_on_1.id,
                "target_membership_id": bob_on_2.id,
                "message": "Jeg skal til tandlæge",
            },
            format="json",
        )
        assert response.status_code == 201

        notifications = _notifications_for(bob, NotificationType.FOOD_TEAM_SWAP_REQUEST)
        assert len(notifications) == 1
        body = notifications[0].message
        # Both days, so the target can answer without opening anything.
        assert f"{d1.day}/{d1.month}" in body
        assert f"{d2.day}/{d2.month}" in body
        assert "Alice" in body
        assert "tandlæge" in body
        assert notifications[0].link == "/madhold/bytte"
        # The requester is not notified about their own request.
        assert _notifications_for(alice) == []

    def test_accepting_tells_the_requester_which_day_is_theirs_now(
        self, api_client, two_teams, alice_and_bob
    ):
        _cycle, team1, team2, d1, d2 = two_teams
        alice, bob = alice_and_bob
        alice_on_1 = FoodTeamMember.objects.create(team=team1, user=alice, house_number="1")
        bob_on_2 = FoodTeamMember.objects.create(team=team2, user=bob, house_number="2")
        swap = TeamSwapRequest.objects.create(
            requester=alice, requester_membership=alice_on_1, target_membership=bob_on_2
        )

        api_client.force_authenticate(user=bob)
        response = api_client.post(
            reverse("food:swap-request-respond", args=[swap.id]),
            {"action": "accept"},
            format="json",
        )
        assert response.status_code == 200

        notifications = _notifications_for(alice, NotificationType.FOOD_TEAM_SWAP_REQUEST)
        assert len(notifications) == 1
        assert "accepteret" in notifications[0].title.lower()
        # Names the responder, not the user who now sits on that membership row.
        assert "Bob" in notifications[0].message
        assert f"{d2.day}/{d2.month}" in notifications[0].message
        assert notifications[0].link == "/madhold/mine-hold"

    def test_declining_tells_the_requester_the_day_is_still_theirs(
        self, api_client, two_teams, alice_and_bob
    ):
        _cycle, team1, team2, d1, _d2 = two_teams
        alice, bob = alice_and_bob
        alice_on_1 = FoodTeamMember.objects.create(team=team1, user=alice, house_number="1")
        bob_on_2 = FoodTeamMember.objects.create(team=team2, user=bob, house_number="2")
        swap = TeamSwapRequest.objects.create(
            requester=alice, requester_membership=alice_on_1, target_membership=bob_on_2
        )

        api_client.force_authenticate(user=bob)
        response = api_client.post(
            reverse("food:swap-request-respond", args=[swap.id]),
            {"action": "decline", "response_message": "Kan desværre ikke"},
            format="json",
        )
        assert response.status_code == 200

        notifications = _notifications_for(alice, NotificationType.FOOD_TEAM_SWAP_REQUEST)
        assert len(notifications) == 1
        assert "afvist" in notifications[0].title.lower()
        assert f"{d1.day}/{d1.month}" in notifications[0].message
        assert "Kan desværre ikke" in notifications[0].message


@pytest.mark.django_db
class TestTakeoverNotification:
    """A takeover is unilateral, so it says so — and cannot be switched off."""

    def test_owner_is_told_their_day_was_taken_and_that_they_owe_one(
        self, api_client, two_teams, alice_and_bob
    ):
        _cycle, team1, _team2, d1, _d2 = two_teams
        alice, bob = alice_and_bob
        alice_on_1 = FoodTeamMember.objects.create(team=team1, user=alice, house_number="1")

        api_client.force_authenticate(user=bob)
        response = api_client.post(
            reverse("food:team-takeover"),
            {"target_membership_id": alice_on_1.id},
            format="json",
        )
        assert response.status_code == 201

        notifications = _notifications_for(alice, NotificationType.FOOD_TEAM_SHIFT_TAKEN)
        assert len(notifications) == 1
        assert notifications[0].title == "Din maddag er overtaget"
        assert "Bob har overtaget din maddag" in notifications[0].message
        assert f"{d1.day}/{d1.month}" in notifications[0].message
        assert "Du skylder nu Bob en tjeneste" in notifications[0].message
        # Not dressed up as a request the owner could have answered.
        assert _notifications_for(alice, NotificationType.FOOD_TEAM_SWAP_REQUEST) == []

    def test_settling_a_debt_says_the_favour_is_squared_not_owed(
        self, api_client, two_teams, alice_and_bob
    ):
        _cycle, team1, _team2, _d1, _d2 = two_teams
        alice, bob = alice_and_bob
        alice_on_1 = FoodTeamMember.objects.create(team=team1, user=alice, house_number="1")
        # Bob owes Alice one; Bob works it off by taking this day of hers.
        favour = TeamFavour.objects.create(
            creditor=alice, debtor=bob, origin_date=timezone.localdate()
        )

        api_client.force_authenticate(user=bob)
        response = api_client.post(
            reverse("food:team-takeover"),
            {"target_membership_id": alice_on_1.id, "settle_favour_id": favour.id},
            format="json",
        )
        assert response.status_code == 201

        notifications = _notifications_for(alice, NotificationType.FOOD_TEAM_SHIFT_TAKEN)
        assert len(notifications) == 1
        assert "udlignet" in notifications[0].message
        assert "Du skylder" not in notifications[0].message

    def test_it_is_delivered_even_with_bytteanmodninger_switched_off(
        self, api_client, two_teams, alice_and_bob
    ):
        """The whole point of the new type: a change already made to your own
        calendar is not something the 'requests' toggle gets to suppress."""
        from apps.notifications.models import NotificationPreference

        _cycle, team1, _team2, _d1, _d2 = two_teams
        alice, bob = alice_and_bob
        NotificationPreference.objects.create(
            user=alice,
            notify_food_swap_request=False,
            email_food_swap_request=False,
            push_food_swap_request=False,
        )
        alice_on_1 = FoodTeamMember.objects.create(team=team1, user=alice, house_number="1")

        api_client.force_authenticate(user=bob)
        response = api_client.post(
            reverse("food:team-takeover"),
            {"target_membership_id": alice_on_1.id},
            format="json",
        )
        assert response.status_code == 201
        assert len(_notifications_for(alice, NotificationType.FOOD_TEAM_SHIFT_TAKEN)) == 1


@pytest.mark.django_db
class TestBroadcastAcceptedWording:
    def test_sender_is_told_which_day_they_have_instead(self, api_client, two_teams, alice_and_bob):
        _cycle, team1, team2, d1, d2 = two_teams
        alice, bob = alice_and_bob
        alice_on_1 = FoodTeamMember.objects.create(team=team1, user=alice, house_number="1")
        bob_on_2 = FoodTeamMember.objects.create(team=team2, user=bob, house_number="2")
        broadcast = SwapBroadcast.objects.create(
            requester=alice,
            requester_membership=alice_on_1,
            available_dates=[d2.isoformat()],
            candidate_user_ids=[bob.id],
            status=BroadcastStatus.OPEN,
        )

        api_client.force_authenticate(user=bob)
        response = api_client.post(
            reverse("food:swap-broadcast-accept", args=[broadcast.id]),
            {"membership_id": bob_on_2.id},
            format="json",
        )
        assert response.status_code == 200

        notifications = _notifications_for(alice, NotificationType.FOOD_TEAM_SWAP_REQUEST)
        assert len(notifications) == 1
        assert "accepteret" in notifications[0].title.lower()
        assert "Bob tager din maddag" in notifications[0].message
        assert f"{d1.day}/{d1.month}" in notifications[0].message
        assert f"{d2.day}/{d2.month}" in notifications[0].message


@pytest.mark.django_db
class TestPlanReadyAnnouncement:
    """Generation is the biggest announcement madhold makes."""

    def _cycle_with_cooks(self, house, house2, future_monday, count=12):
        d1 = future_monday
        d2 = future_monday + timedelta(days=1)
        cycle = FoodTeamCycle.objects.create(
            name="Madhold september",
            cooking_dates=[d1.isoformat(), d2.isoformat()],
            wish_deadline=timezone.now() + timedelta(days=2),
            status=CycleStatus.COLLECTING_WISHES,
        )
        # Enough cooks for two full teams of six, all in one of two houses, so
        # the generator has a feasible problem to solve.
        for i in range(count):
            User.objects.create_user(
                email=f"cook{i}@notif.dk",
                password="x",
                first_name=f"Kok{i}",
                house=house if i % 2 else house2,
                can_be_head_chef=True,
            )
        return cycle, d1, d2

    def test_every_assigned_cook_is_told_their_own_days(
        self, api_client, admin_user, house, house2, future_monday
    ):
        cycle, d1, d2 = self._cycle_with_cooks(house, house2, future_monday)

        api_client.force_authenticate(user=admin_user)
        response = api_client.post(
            reverse("food:generate-teams"), {"cycle_id": cycle.id}, format="json"
        )
        assert response.status_code == 200
        assert response.data["teams_created"] == 2

        for member in FoodTeamMember.objects.filter(team__cycle=cycle).select_related(
            "team", "user"
        ):
            notifications = _notifications_for(member.user, NotificationType.FOOD_TEAM_PLAN_READY)
            assert len(notifications) == 1, f"{member.user.first_name} was not told"
            d = member.team.date
            assert f"{d.day}/{d.month}" in notifications[0].message
            assert cycle.name in notifications[0].message
            assert notifications[0].link == "/madhold/mine-hold"

    def test_a_dry_run_announces_nothing(
        self, api_client, admin_user, house, house2, future_monday
    ):
        cycle, _d1, _d2 = self._cycle_with_cooks(house, house2, future_monday)

        api_client.force_authenticate(user=admin_user)
        response = api_client.post(
            reverse("food:generate-teams"),
            {"cycle_id": cycle.id, "dry_run": True},
            format="json",
        )
        assert response.status_code == 200
        assert (
            Notification.objects.filter(
                notification_type=NotificationType.FOOD_TEAM_PLAN_READY
            ).count()
            == 0
        )

    def test_nobody_is_told_when_no_teams_were_saved(self, api_client, admin_user, future_monday):
        """An empty pool produces no plan, so there is nothing to announce."""
        cycle = FoodTeamCycle.objects.create(
            name="Tom periode",
            cooking_dates=[future_monday.isoformat()],
            wish_deadline=timezone.now() + timedelta(days=2),
            status=CycleStatus.COLLECTING_WISHES,
        )
        User.objects.filter(is_active=True).update(is_exempt_from_food_teams=True)

        api_client.force_authenticate(user=admin_user)
        response = api_client.post(
            reverse("food:generate-teams"), {"cycle_id": cycle.id}, format="json"
        )
        assert response.status_code == 200
        assert (
            Notification.objects.filter(
                notification_type=NotificationType.FOOD_TEAM_PLAN_READY
            ).count()
            == 0
        )


@pytest.mark.django_db
class TestNewCycleAnnouncement:
    """Opening a period invites the participants and re-asks the paused."""

    def test_participants_are_invited_and_paused_residents_are_asked_instead(
        self, api_client, admin_user, house, future_monday
    ):
        cook = User.objects.create_user(
            email="cook@cycle.dk", password="x", first_name="Kok", house=house
        )
        paused = User.objects.create_user(
            email="paused@cycle.dk",
            password="x",
            first_name="Pause",
            house=house,
            is_exempt_from_food_teams=True,
        )

        api_client.force_authenticate(user=admin_user)
        response = api_client.post(
            reverse("food:cycle-list"),
            {
                "name": "Madhold oktober",
                "cooking_dates": [future_monday.isoformat()],
                "wish_deadline": (timezone.now() + timedelta(days=5)).isoformat(),
            },
            format="json",
        )
        assert response.status_code == 201

        invited = _notifications_for(cook, NotificationType.FOOD_TEAM_WISHES_OPEN)
        assert len(invited) == 1
        assert "åbnet for madholdsønsker" in invited[0].title.lower()
        assert "Madhold oktober" in invited[0].message
        assert invited[0].link == "/madhold/oensker"

        asked = _notifications_for(paused, NotificationType.FOOD_TEAM_PAUSE_CHECK)
        assert len(asked) == 1
        # Nobody gets both questions.
        assert _notifications_for(paused, NotificationType.FOOD_TEAM_WISHES_OPEN) == []
        assert _notifications_for(cook, NotificationType.FOOD_TEAM_PAUSE_CHECK) == []


@pytest.mark.django_db
class TestWishDeadlineReminder:
    """One nudge per period, to the people who still owe a wish."""

    def _cycle(self, hours_to_deadline, future_monday):
        return FoodTeamCycle.objects.create(
            name="Madhold november",
            cooking_dates=[future_monday.isoformat()],
            wish_deadline=timezone.now() + timedelta(hours=hours_to_deadline),
            status=CycleStatus.COLLECTING_WISHES,
        )

    def test_only_residents_without_a_wish_are_nudged(self, db, house, future_monday):
        from apps.food.tasks import send_wish_deadline_reminders

        cycle = self._cycle(30, future_monday)
        silent = User.objects.create_user(
            email="silent@wish.dk", password="x", first_name="Stille", house=house
        )
        answered = User.objects.create_user(
            email="answered@wish.dk", password="x", first_name="Svaret", house=house
        )
        paused = User.objects.create_user(
            email="paused@wish.dk",
            password="x",
            first_name="Pause",
            house=house,
            is_exempt_from_food_teams=True,
        )
        FoodTeamWish.objects.create(
            cycle=cycle, user=answered, available_dates=[future_monday.isoformat()]
        )

        send_wish_deadline_reminders()

        nudged = _notifications_for(silent, NotificationType.FOOD_TEAM_WISHES_OPEN)
        assert len(nudged) == 1
        assert nudged[0].title == "Husk dine madholdsønsker"
        assert "Madhold november" in nudged[0].message
        assert _notifications_for(answered, NotificationType.FOOD_TEAM_WISHES_OPEN) == []
        assert _notifications_for(paused, NotificationType.FOOD_TEAM_WISHES_OPEN) == []

        cycle.refresh_from_db()
        assert cycle.wish_reminder_sent_at is not None

    def test_it_never_nudges_twice_for_one_period(self, db, house, future_monday):
        from apps.food.tasks import send_wish_deadline_reminders

        self._cycle(30, future_monday)
        User.objects.create_user(
            email="silent2@wish.dk", password="x", first_name="Stille", house=house
        )

        send_wish_deadline_reminders()
        send_wish_deadline_reminders()

        assert (
            Notification.objects.filter(
                notification_type=NotificationType.FOOD_TEAM_WISHES_OPEN,
                title="Husk dine madholdsønsker",
            ).count()
            == 1
        )

    def test_a_deadline_outside_the_window_is_left_alone(self, db, house, future_monday):
        """Too far off, and already past, both mean "not now"."""
        from apps.food.tasks import send_wish_deadline_reminders

        far = self._cycle(24 * 9, future_monday)
        past = self._cycle(-1, future_monday)
        User.objects.create_user(
            email="silent3@wish.dk", password="x", first_name="Stille", house=house
        )

        send_wish_deadline_reminders()

        assert (
            Notification.objects.filter(
                notification_type=NotificationType.FOOD_TEAM_WISHES_OPEN
            ).count()
            == 0
        )
        far.refresh_from_db()
        past.refresh_from_db()
        assert far.wish_reminder_sent_at is None
        assert past.wish_reminder_sent_at is None
