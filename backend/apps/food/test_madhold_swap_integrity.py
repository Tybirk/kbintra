"""Bytte and broadcasts only ever move the person who asked, and only before the day.

Found in the 2026-10-02 bug hunt (docs/madhold-bughunt-2026-10-02.md, S1–S3):
an accepted 1:1 bytte left the requester's broadcast open, swaps never expired,
and two accepts of requests on the same day could drop a cook from every team.
"""

from datetime import timedelta
from unittest.mock import patch

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.food.models import (
    BroadcastStatus,
    CycleStatus,
    FoodTeam,
    FoodTeamCycle,
    FoodTeamMember,
    SwapBroadcast,
    SwapRequestStatus,
    TeamSwapRequest,
)
from apps.houses.models import House
from apps.notifications.models import Notification
from apps.users.models import User


@pytest.fixture
def future_monday():
    base = timezone.localdate() + timedelta(weeks=140)
    return base + timedelta(days=(7 - base.weekday()) % 7)


@pytest.fixture
def cycle(db, future_monday):
    return FoodTeamCycle.objects.create(
        name="Byttetest",
        cooking_dates=[(future_monday + timedelta(days=i)).isoformat() for i in range(3)],
        wish_deadline=timezone.now() - timedelta(days=1),
        status=CycleStatus.FINALIZED,
    )


@pytest.fixture
def three_teams(cycle, future_monday):
    dates = [future_monday + timedelta(days=i) for i in range(3)]
    return [FoodTeam.objects.create(cycle=cycle, date=d) for d in dates], dates


@pytest.fixture
def three_people(db):
    houses = [
        House.objects.create(name=f"Byttevej {n}", address=f"Byttevej {n}") for n in (11, 12, 13)
    ]
    return [
        User.objects.create_user(
            email=f"{name.lower()}@bytte.dk", password="x", first_name=name, house=h
        )
        for name, h in zip(("Anna", "Bo", "Cai"), houses, strict=True)
    ]


def _dates_of(user):
    return sorted(FoodTeamMember.objects.filter(user=user).values_list("team__date", flat=True))


def _past_team(cycle):
    return FoodTeam.objects.create(cycle=cycle, date=timezone.localdate() - timedelta(days=1))


@pytest.mark.django_db
def test_accepted_bytte_closes_the_requesters_broadcast(api_client, three_teams, three_people):
    """Anna broadcasts d1, then swaps d1<->d2 with Bo 1:1. Cai can no longer take
    the broadcast — before the fix it moved Bo to d3 without asking him."""
    (t1, t2, t3), (d1, d2, d3) = three_teams
    anna, bo, cai = three_people
    m_anna = FoodTeamMember.objects.create(team=t1, user=anna, house_number="11")
    m_bo = FoodTeamMember.objects.create(team=t2, user=bo, house_number="12")
    m_cai = FoodTeamMember.objects.create(team=t3, user=cai, house_number="13")

    api_client.force_authenticate(user=anna)
    resp = api_client.post(
        reverse("food:swap-broadcast-list"),
        {"requester_membership_id": m_anna.id, "available_dates": [d3.isoformat()]},
        format="json",
    )
    assert resp.status_code == 201, resp.data
    broadcast = SwapBroadcast.objects.get(pk=resp.data["id"])
    resp = api_client.post(
        reverse("food:swap-request-list"),
        {"requester_membership_id": m_anna.id, "target_membership_id": m_bo.id},
        format="json",
    )
    assert resp.status_code == 201, resp.data
    swap = TeamSwapRequest.objects.get(requester=anna)

    api_client.force_authenticate(user=bo)
    resp = api_client.post(
        reverse("food:swap-request-respond", args=[swap.id]), {"action": "accept"}, format="json"
    )
    assert resp.status_code == 200, resp.data
    broadcast.refresh_from_db()
    assert broadcast.status == BroadcastStatus.CANCELLED

    api_client.force_authenticate(user=cai)
    resp = api_client.post(
        reverse("food:swap-broadcast-accept", args=[broadcast.id]),
        {"membership_id": m_cai.id},
        format="json",
    )
    assert resp.status_code == 400
    assert _dates_of(anna) == [d2]
    assert _dates_of(bo) == [d1]
    assert _dates_of(cai) == [d3]


@pytest.mark.django_db
def test_broadcast_whose_day_changed_hands_is_refused_and_closed(
    api_client, three_teams, three_people
):
    """However the sender's day moved, an open broadcast must not move its new holder."""
    (t1, _t2, t3), (_d1, _d2, d3) = three_teams
    anna, bo, cai = three_people
    m_anna = FoodTeamMember.objects.create(team=t1, user=anna, house_number="11")
    m_cai = FoodTeamMember.objects.create(team=t3, user=cai, house_number="13")
    broadcast = SwapBroadcast.objects.create(
        requester=anna,
        requester_membership=m_anna,
        available_dates=[d3.isoformat()],
        candidate_user_ids=[cai.id],
    )
    # The day changes hands behind the broadcast's back (e.g. an admin edit).
    FoodTeamMember.objects.filter(pk=m_anna.pk).update(user=bo)

    api_client.force_authenticate(user=cai)
    resp = api_client.post(
        reverse("food:swap-broadcast-accept", args=[broadcast.id]),
        {"membership_id": m_cai.id},
        format="json",
    )

    assert resp.status_code == 400
    assert "skiftet hænder" in resp.data["detail"]
    broadcast.refresh_from_db()
    assert broadcast.status == BroadcastStatus.CANCELLED
    assert _dates_of(bo) == [t1.date]
    assert _dates_of(cai) == [d3]


@pytest.mark.django_db
def test_broadcast_for_a_day_that_has_passed_is_hidden_and_refused(
    api_client, cycle, three_teams, three_people
):
    (_t1, _t2, t3), (_d1, _d2, d3) = three_teams
    anna, _bo, cai = three_people
    m_anna = FoodTeamMember.objects.create(team=_past_team(cycle), user=anna, house_number="11")
    m_cai = FoodTeamMember.objects.create(team=t3, user=cai, house_number="13")
    broadcast = SwapBroadcast.objects.create(
        requester=anna,
        requester_membership=m_anna,
        available_dates=[d3.isoformat()],
        candidate_user_ids=[cai.id],
    )

    api_client.force_authenticate(user=cai)
    listing = api_client.get(reverse("food:swap-broadcast-list"))
    assert broadcast.id not in [b["id"] for b in listing.data]

    resp = api_client.post(
        reverse("food:swap-broadcast-accept", args=[broadcast.id]),
        {"membership_id": m_cai.id},
        format="json",
    )
    assert resp.status_code == 400
    assert resp.data["detail"] == "Maddagen er allerede passeret."
    assert _dates_of(cai) == [d3]


@pytest.mark.django_db
def test_bytte_for_a_day_that_has_passed_is_hidden_and_refused(
    api_client, cycle, three_teams, three_people
):
    (_t1, t2, _t3), (_d1, d2, _d3) = three_teams
    anna, bo, _cai = three_people
    m_anna = FoodTeamMember.objects.create(team=_past_team(cycle), user=anna, house_number="11")
    m_bo = FoodTeamMember.objects.create(team=t2, user=bo, house_number="12")
    swap = TeamSwapRequest.objects.create(
        requester=anna, requester_membership=m_anna, target_membership=m_bo
    )

    api_client.force_authenticate(user=bo)
    listing = api_client.get(reverse("food:swap-request-list"))
    assert swap.id not in [r["id"] for r in listing.data]

    resp = api_client.post(
        reverse("food:swap-request-respond", args=[swap.id]), {"action": "accept"}, format="json"
    )
    assert resp.status_code == 400
    assert resp.data["detail"] == "Maddagen er allerede passeret."
    assert _dates_of(bo) == [d2]


@pytest.mark.django_db
def test_bytte_cannot_be_asked_for_a_day_that_has_passed(
    api_client, cycle, three_teams, three_people
):
    (_t1, t2, _t3), _dates = three_teams
    anna, bo, _cai = three_people
    m_anna = FoodTeamMember.objects.create(team=_past_team(cycle), user=anna, house_number="11")
    m_bo = FoodTeamMember.objects.create(team=t2, user=bo, house_number="12")

    api_client.force_authenticate(user=anna)
    resp = api_client.post(
        reverse("food:swap-request-list"),
        {"requester_membership_id": m_anna.id, "target_membership_id": m_bo.id},
        format="json",
    )

    assert resp.status_code == 400
    assert not TeamSwapRequest.objects.exists()


@pytest.mark.django_db
def test_can_accept_is_only_for_the_person_who_can_answer(api_client, three_teams, three_people):
    (t1, t2, _t3), _dates = three_teams
    anna, bo, _cai = three_people
    m_anna = FoodTeamMember.objects.create(team=t1, user=anna, house_number="11")
    m_bo = FoodTeamMember.objects.create(team=t2, user=bo, house_number="12")
    TeamSwapRequest.objects.create(
        requester=anna, requester_membership=m_anna, target_membership=m_bo
    )

    api_client.force_authenticate(user=bo)
    assert api_client.get(reverse("food:swap-request-list")).data[0]["can_accept"] is True
    api_client.force_authenticate(user=anna)
    assert api_client.get(reverse("food:swap-request-list")).data[0]["can_accept"] is False


@pytest.mark.django_db
def test_a_second_accept_on_the_same_day_is_refused_not_applied_to_stale_rows(
    api_client, three_teams, three_people
):
    """Anna asks both Bo and Cai for her d1. Bo's accept lands while Cai's request
    is already being handled: Cai's must see that the request was cancelled,
    not drop Bo from every team and put Anna on two."""
    (t1, t2, t3), (d1, d2, d3) = three_teams
    anna, bo, cai = three_people
    m_anna = FoodTeamMember.objects.create(team=t1, user=anna, house_number="11")
    m_bo = FoodTeamMember.objects.create(team=t2, user=bo, house_number="12")
    m_cai = FoodTeamMember.objects.create(team=t3, user=cai, house_number="13")
    r_bo = TeamSwapRequest.objects.create(
        requester=anna, requester_membership=m_anna, target_membership=m_bo
    )
    r_cai = TeamSwapRequest.objects.create(
        requester=anna, requester_membership=m_anna, target_membership=m_cai
    )

    from apps.food import views as food_views

    original_is_valid = food_views.RespondSwapRequestSerializer.is_valid
    state = {"interleaved": False}

    def is_valid_with_interleaving(self, *args, **kwargs):
        # Runs inside Cai's request, before it reads the swap request.
        if not state["interleaved"]:
            state["interleaved"] = True
            from rest_framework.test import APIClient

            other = APIClient()
            other.force_authenticate(user=bo)
            r = other.post(
                reverse("food:swap-request-respond", args=[r_bo.id]),
                {"action": "accept"},
                format="json",
            )
            assert r.status_code == 200, r.data
        return original_is_valid(self, *args, **kwargs)

    api_client.force_authenticate(user=cai)
    with patch.object(
        food_views.RespondSwapRequestSerializer, "is_valid", is_valid_with_interleaving
    ):
        resp = api_client.post(
            reverse("food:swap-request-respond", args=[r_cai.id]),
            {"action": "accept"},
            format="json",
        )

    assert resp.status_code == 400
    r_cai.refresh_from_db()
    assert r_cai.status == SwapRequestStatus.CANCELLED
    assert _dates_of(anna) == [d2]
    assert _dates_of(bo) == [d1]
    assert _dates_of(cai) == [d3]


@pytest.mark.django_db
def test_declining_still_tells_the_requester(api_client, three_teams, three_people):
    (t1, t2, _t3), _dates = three_teams
    anna, bo, _cai = three_people
    m_anna = FoodTeamMember.objects.create(team=t1, user=anna, house_number="11")
    m_bo = FoodTeamMember.objects.create(team=t2, user=bo, house_number="12")
    swap = TeamSwapRequest.objects.create(
        requester=anna, requester_membership=m_anna, target_membership=m_bo
    )

    api_client.force_authenticate(user=bo)
    resp = api_client.post(
        reverse("food:swap-request-respond", args=[swap.id]), {"action": "decline"}, format="json"
    )

    assert resp.status_code == 200
    swap.refresh_from_db()
    assert swap.status == SwapRequestStatus.DECLINED
    assert Notification.objects.filter(user=anna, title="Dit bytte blev afvist").exists()
