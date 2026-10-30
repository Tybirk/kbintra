"""Handovers: residents moving out, new ones moving in, each step on its day."""

from datetime import date, timedelta

import pytest
from django.core import mail
from django.utils import timezone

from apps.food.models import (
    CycleStatus,
    FoodTeam,
    FoodTeamCycle,
    FoodTeamMember,
    MealPreference,
    MealRegistration,
)
from apps.houses.handover import one_month_after, process_handover
from apps.houses.models import Car, Child, Handover, House
from apps.notifications.models import NotificationType
from apps.notifications.services import create_notification
from apps.users.models import Invitation, User

URL = "/api/houses/handovers/"


@pytest.fixture
def today():
    return timezone.localdate()


@pytest.fixture
def house40(db):
    house = House.objects.create(name="Kløverbakkevej 40", description="Familien Hansen")
    Child.objects.create(house=house, name="Lille Hansen")
    Car.objects.create(house=house, license_plate="AB12345")
    MealPreference.objects.create(house=house, day_of_week=0, adults_veg=2, children_count=1)
    return house


@pytest.fixture
def old_residents(house40):
    return [
        User.objects.create_user(
            email=f"gammel{i}@example.com", password="x", first_name=f"Gammel{i}", house=house40
        )
        for i in range(2)
    ]


def _payload(house, outgoing, today, **overrides):
    payload = {
        "house": house.slug,
        "handover_date": today.isoformat(),
        "invite_on": (today - timedelta(days=2)).isoformat(),
        "access_until": (today + timedelta(days=30)).isoformat(),
        "reset_household": True,
        "outgoing": [u.pk for u in outgoing],
        "incoming": [
            {
                "first_name": "Ny",
                "last_name": "Beboer",
                "email": "Ny@Example.com",
                "phone_number": "12345678",
            }
        ],
    }
    payload.update(overrides)
    return payload


def _handover(house, outgoing, today, *, handover_in=7, invite_days_before=2, access_days=30):
    handover_date = today + timedelta(days=handover_in)
    handover = Handover.objects.create(
        house=house,
        handover_date=handover_date,
        invite_on=handover_date - timedelta(days=invite_days_before),
        access_until=handover_date + timedelta(days=access_days),
        reset_household=True,
    )
    handover.outgoing.set(outgoing)
    Invitation.objects.create(
        house=house,
        handover=handover,
        email="ny@example.com",
        first_name="Ny",
        send_on=handover.invite_on,
    )
    return handover


class TestHandoverToday:
    """A handover dated today — house 40's case — is carried out in the request."""

    def test_everything_due_happens_at_once(
        self, admin_client, house40, old_residents, today, django_capture_on_commit_callbacks
    ):
        with django_capture_on_commit_callbacks(execute=True):
            response = admin_client.post(
                URL, _payload(house40, old_residents, today), format="json"
            )

        assert response.status_code == 201, response.data
        for user in old_residents:
            user.refresh_from_db()
            assert user.house is None
            assert user.moved_out_on == today
            assert user.is_active  # still has access for a month

        house40.refresh_from_db()
        assert house40.description == ""
        assert not house40.children.exists()
        assert not house40.cars.exists()
        assert not MealPreference.objects.filter(house=house40).exists()

        invitation = Invitation.objects.get(email="ny@example.com")
        assert invitation.sent_at is not None
        assert invitation.expires_at > timezone.now() + timedelta(days=13)
        assert [m.to for m in mail.outbox] == [["ny@example.com"]]
        body = mail.outbox[0].body
        assert f"/register?token={invitation.token}" in body
        assert "/mad/praeferencer" in body
        assert "Føj til startskærm" in body

        data = response.data
        assert data["invitations"][0]["status"] == "sent"
        assert data["can_cancel"] is False

    def test_only_staff_may_register_a_handover(self, authenticated_client, house40, today):
        response = authenticated_client.post(URL, _payload(house40, [], today), format="json")
        assert response.status_code == 403


class TestHandoverSteps:
    """A handover ahead of time waits for each of its days."""

    def test_each_step_waits_for_its_day(self, house40, old_residents, today):
        handover = _handover(house40, old_residents, today)

        process_handover(handover.pk, today=today)
        assert Invitation.objects.get().sent_at is None
        assert house40.children.exists()

        # Invite day: the new household is invited. The old one still lives here
        # and keeps its things until a newcomer takes the house over.
        process_handover(handover.pk, today=handover.invite_on)
        handover.refresh_from_db()
        assert Invitation.objects.get().sent_at is not None
        assert handover.household_reset_at is None
        assert house40.children.exists()
        assert User.objects.filter(house=house40).count() == 2

        # Handover day: the old residents move out, and with nobody registered
        # yet the house is cleared now.
        process_handover(handover.pk, today=handover.handover_date)
        assert not User.objects.filter(house=house40).exists()
        handover.refresh_from_db()
        assert handover.household_reset_at is not None
        assert not house40.children.exists()
        assert all(u.is_active for u in User.objects.filter(pk__in=[u.pk for u in old_residents]))

        # The last day of access is still a day with access.
        process_handover(handover.pk, today=handover.access_until)
        assert User.objects.filter(pk=old_residents[0].pk, is_active=True).exists()

        process_handover(handover.pk, today=handover.access_until + timedelta(days=1))
        handover.refresh_from_db()
        assert handover.access_ended_at is not None
        assert not User.objects.filter(
            pk__in=[u.pk for u in old_residents], is_active=True
        ).exists()
        # Deactivated, never deleted.
        assert User.objects.filter(pk__in=[u.pk for u in old_residents]).count() == 2

    def test_the_first_newcomer_to_register_takes_the_house_over(
        self, api_client, house40, old_residents, today
    ):
        handover = _handover(house40, old_residents, today, handover_in=2)
        process_handover(handover.pk)
        invitation = Invitation.objects.get()
        assert invitation.sent_at is not None
        assert house40.children.exists()

        response = _register(api_client, invitation)

        assert response.status_code == 201, response.data
        handover.refresh_from_db()
        assert handover.household_reset_at is not None
        assert not house40.children.exists()
        assert not MealPreference.objects.filter(house=house40).exists()
        assert User.objects.filter(house=house40).count() == 3  # the old ones still live here

    def test_what_the_new_household_adds_before_the_handover_stays(
        self, api_client, house40, old_residents, today
    ):
        handover = _handover(house40, old_residents, today, handover_in=2)
        process_handover(handover.pk)
        _register(api_client, Invitation.objects.get())
        newcomer = User.objects.get(email="ny@example.com")

        Child.objects.create(house=house40, name="Ny baby")
        MealPreference.objects.create(house=house40, day_of_week=1, adults_veg=1)

        process_handover(handover.pk, today=handover.handover_date)

        assert list(house40.children.values_list("name", flat=True)) == ["Ny baby"]
        assert MealPreference.objects.filter(house=house40).exists()
        assert list(User.objects.filter(house=house40)) == [newcomer]

    def test_without_anyone_invited_the_reset_waits_for_the_handover_day(
        self, house40, old_residents, today
    ):
        handover = _handover(house40, old_residents, today)
        handover.invitations.all().delete()

        process_handover(handover.pk, today=handover.invite_on)
        assert house40.children.exists()

        process_handover(handover.pk, today=handover.handover_date)
        assert not house40.children.exists()

    def test_reset_is_called_off_when_someone_else_lives_there(self, house40, old_residents, today):
        handover = _handover(house40, old_residents, today)
        User.objects.create_user(email="fremlejer@example.com", password="x", house=house40)

        process_handover(handover.pk, today=handover.handover_date)

        handover.refresh_from_db()
        assert handover.reset_household is False
        assert house40.children.exists()

    def test_a_car_with_loans_is_kept_but_leaves_the_delebilpark(
        self, house40, old_residents, today
    ):
        from apps.carsharing.models import CarLoan

        car = house40.cars.get()
        car.is_shared = True
        car.save()
        CarLoan.objects.create(
            borrower=old_residents[0],
            car=car,
            start_at=timezone.now(),
            end_at=timezone.now() + timedelta(hours=2),
            expected_km=10,
            terms_version="1",
        )
        handover = _handover(house40, old_residents, today)

        process_handover(handover.pk, today=handover.handover_date)

        car.refresh_from_db()
        assert car.is_shared is False

    def test_requests_waiting_on_the_cars_are_answered(
        self, house40, old_residents, user, today, django_capture_on_commit_callbacks
    ):
        from apps.carsharing.models import CarLoan, CarLoanCandidate
        from apps.notifications.models import Notification

        lent_before = house40.cars.get()
        CarLoan.objects.create(
            borrower=user,
            car=lent_before,
            status=CarLoan.Status.COMPLETED,
            start_at=timezone.now() - timedelta(days=9),
            end_at=timezone.now() - timedelta(days=8),
            expected_km=10,
            terms_version="1",
        )
        never_lent = Car.objects.create(house=house40, license_plate="CD67890", is_shared=True)
        lent_before.is_shared = True
        lent_before.save()
        waiting = []
        for car in (lent_before, never_lent):
            loan = CarLoan.objects.create(
                borrower=user,
                start_at=timezone.now() + timedelta(days=10),
                end_at=timezone.now() + timedelta(days=10, hours=2),
                expected_km=10,
                terms_version="1",
            )
            CarLoanCandidate.objects.create(loan=loan, car=car)
            waiting.append(loan)
        handover = _handover(house40, old_residents, today)

        with django_capture_on_commit_callbacks(execute=True):
            process_handover(handover.pk, today=handover.handover_date)

        assert not Car.objects.filter(pk=never_lent.pk).exists()
        assert lent_before.loan_candidacies.get().status == CarLoanCandidate.Status.DECLINED
        # Nobody else was asked, so neither request is left waiting.
        for loan in waiting:
            loan.refresh_from_db()
            assert loan.status == CarLoan.Status.DECLINED
        assert (
            Notification.objects.filter(
                user=user, notification_type=NotificationType.CAR_LOAN_UPDATE
            ).count()
            == 2
        )

    def test_moving_out_drops_upcoming_maddage_but_not_past_ones(
        self, admin_user, house40, old_residents, today
    ):
        cook = old_residents[0]
        cycle = FoodTeamCycle.objects.create(
            name="P",
            cooking_dates=[],
            wish_deadline=timezone.now(),
            status=CycleStatus.FINALIZED,
            created_by=admin_user,
        )
        handover = _handover(house40, old_residents, today)
        past = FoodTeam.objects.create(cycle=cycle, date=today - timedelta(days=3))
        # The handover day stays theirs: they've been reminded and may cook first.
        moving_day = FoodTeam.objects.create(cycle=cycle, date=handover.handover_date)
        upcoming = FoodTeam.objects.create(cycle=cycle, date=today + timedelta(days=10))
        for team in (past, moving_day, upcoming):
            FoodTeamMember.objects.create(team=team, user=cook)

        listed = handover_data(handover)
        assert listed["outgoing"][0]["upcoming_food_shifts"] == [upcoming.date.isoformat()]

        process_handover(handover.pk, today=handover.handover_date)

        kept = FoodTeamMember.objects.filter(user=cook).values_list("team_id", flat=True)
        assert sorted(kept) == sorted([past.pk, moving_day.pk])

    def test_a_neighbour_waiting_on_a_bytte_with_a_leaver_is_told(
        self,
        admin_user,
        house40,
        old_residents,
        user_with_house,
        today,
        django_capture_on_commit_callbacks,
    ):
        from apps.food.models import TeamSwapRequest
        from apps.notifications.models import Notification

        cycle = FoodTeamCycle.objects.create(
            name="P",
            cooking_dates=[],
            wish_deadline=timezone.now(),
            status=CycleStatus.FINALIZED,
            created_by=admin_user,
        )
        handover = _handover(house40, old_residents, today)
        leavers_day = FoodTeam.objects.create(cycle=cycle, date=today + timedelta(days=10))
        neighbours_day = FoodTeam.objects.create(cycle=cycle, date=today + timedelta(days=12))
        swap = TeamSwapRequest.objects.create(
            requester=user_with_house,
            requester_membership=FoodTeamMember.objects.create(
                team=neighbours_day, user=user_with_house
            ),
            target_membership=FoodTeamMember.objects.create(
                team=leavers_day, user=old_residents[0]
            ),
        )

        with django_capture_on_commit_callbacks(execute=True):
            process_handover(handover.pk, today=handover.handover_date)

        assert not TeamSwapRequest.objects.filter(pk=swap.pk).exists()
        notice = Notification.objects.get(
            user=user_with_house, notification_type=NotificationType.FOOD_TEAM_SWAP_REQUEST
        )
        assert notice.title == "Dit bytte gik ikke igennem"
        assert "Gammel0 er flyttet" in notice.message

    def test_open_meal_registrations_from_the_handover_day_are_cleared(
        self, house40, old_residents, today
    ):
        handover = _handover(house40, old_residents, today, handover_in=21)
        monday = handover.handover_date + timedelta(days=7 - handover.handover_date.weekday())
        before = handover.handover_date - timedelta(days=handover.handover_date.weekday() + 7)
        MealRegistration.objects.create(house=house40, date=monday, adults_veg=2)
        MealRegistration.objects.create(house=house40, date=before, adults_veg=2)

        process_handover(handover.pk, today=handover.handover_date)

        assert list(
            MealRegistration.objects.filter(house=house40).values_list("date", flat=True)
        ) == [before]


def handover_data(handover):
    from apps.houses.serializers import HandoverSerializer

    return HandoverSerializer(handover).data


def _register(api_client, invitation):
    return api_client.post(
        "/api/auth/register/",
        {
            "token": invitation.token,
            "email": invitation.email,
            "password": "EtGodtKodeord123!",
            "password_confirm": "EtGodtKodeord123!",
            "first_name": "Ny",
            "last_name": "Beboer",
        },
        format="json",
    )


class TestHandoverValidation:
    def test_outgoing_must_live_in_the_house(self, admin_client, house40, user_with_house, today):
        response = admin_client.post(
            URL, _payload(house40, [user_with_house], today, reset_household=False), format="json"
        )
        assert response.status_code == 400
        assert "outgoing" in response.data

    def test_reset_needs_everyone_to_move(self, admin_client, house40, old_residents, today):
        response = admin_client.post(
            URL, _payload(house40, old_residents[:1], today), format="json"
        )
        assert response.status_code == 400
        assert "reset_household" in response.data

    def test_an_existing_member_cannot_be_invited(self, admin_client, house40, user, today):
        payload = _payload(house40, [], today, reset_household=False)
        payload["incoming"][0]["email"] = user.email.upper()
        response = admin_client.post(URL, payload, format="json")
        assert response.status_code == 400

    def test_someone_already_invited_cannot_be_invited_twice(
        self, admin_client, house40, old_residents, today
    ):
        _handover(house40, [], today)
        response = admin_client.post(
            URL, _payload(house40, [], today, reset_household=False), format="json"
        )
        assert response.status_code == 400

    def test_invitations_cannot_go_out_after_the_handover(
        self, admin_client, house40, old_residents, today
    ):
        later = (today + timedelta(days=1)).isoformat()
        response = admin_client.post(
            URL, _payload(house40, old_residents, today, invite_on=later), format="json"
        )
        assert response.status_code == 400
        assert "invite_on" in response.data

        handover = _handover(house40, old_residents, today)
        response = admin_client.patch(
            f"{URL}{handover.pk}/",
            {"handover_date": (handover.invite_on - timedelta(days=1)).isoformat()},
            format="json",
        )
        assert response.status_code == 400
        assert "invite_on" in response.data

    def test_a_newcomer_without_a_first_name_is_named_in_the_error(
        self, admin_client, house40, old_residents, today
    ):
        payload = _payload(house40, old_residents, today)
        payload["incoming"][0]["first_name"] = ""
        response = admin_client.post(URL, payload, format="json")
        assert response.status_code == 400
        assert response.data["incoming"][0]["first_name"] == [
            "Skriv fornavn på alle, der flytter ind."
        ]

    def test_access_cannot_end_before_the_handover(
        self, admin_client, house40, old_residents, today
    ):
        payload = _payload(
            house40, old_residents, today, access_until=(today - timedelta(days=1)).isoformat()
        )
        assert admin_client.post(URL, payload, format="json").status_code == 400


class TestFailures:
    def test_a_failing_step_leaves_nothing_saved(
        self, admin_client, house40, old_residents, today, monkeypatch
    ):
        def broken(*args, **kwargs):
            raise RuntimeError("boom")

        monkeypatch.setattr("apps.houses.views.process_handover", broken)

        with pytest.raises(RuntimeError):
            admin_client.post(URL, _payload(house40, old_residents, today), format="json")

        assert not Handover.objects.exists()
        assert not Invitation.objects.exists()

    def test_a_failing_step_does_not_stop_a_newcomer_registering(
        self, api_client, house40, old_residents, today, monkeypatch
    ):
        handover = _handover(house40, old_residents, today, handover_in=2)
        process_handover(handover.pk)

        def broken(*args, **kwargs):
            raise RuntimeError("boom")

        monkeypatch.setattr("apps.houses.handover.process_handover", broken)
        response = _register(api_client, Invitation.objects.get())

        assert response.status_code == 201, response.data
        assert User.objects.filter(email="ny@example.com", house=house40).exists()


class TestChangingAndCancelling:
    def test_a_handover_not_started_can_be_cancelled(
        self, admin_client, house40, old_residents, today
    ):
        handover = _handover(house40, old_residents, today)
        assert admin_client.delete(f"{URL}{handover.pk}/").status_code == 204
        assert not Invitation.objects.exists()

    def test_a_started_handover_cannot(self, admin_client, house40, old_residents, today):
        handover = _handover(house40, old_residents, today, handover_in=0)
        process_handover(handover.pk, today=today)
        assert admin_client.delete(f"{URL}{handover.pk}/").status_code == 400

    def test_moving_the_invite_day_moves_the_invitations(
        self, admin_client, house40, old_residents, today
    ):
        handover = _handover(house40, old_residents, today)
        new_day = handover.invite_on - timedelta(days=1)
        response = admin_client.patch(
            f"{URL}{handover.pk}/", {"invite_on": new_day.isoformat()}, format="json"
        )
        assert response.status_code == 200
        assert Invitation.objects.get().send_on == new_day

    def test_a_date_that_has_run_cannot_be_moved(self, admin_client, house40, old_residents, today):
        handover = _handover(house40, old_residents, today, handover_in=0)
        process_handover(handover.pk, today=today)
        response = admin_client.patch(
            f"{URL}{handover.pk}/",
            {"handover_date": (today + timedelta(days=3)).isoformat()},
            format="json",
        )
        assert response.status_code == 400

    def test_resend_mails_again_with_fresh_validity(
        self, admin_client, house40, old_residents, today, django_capture_on_commit_callbacks
    ):
        handover = _handover(house40, old_residents, today, handover_in=0)
        with django_capture_on_commit_callbacks(execute=True):
            process_handover(handover.pk, today=today)
        invitation = Invitation.objects.get()
        Invitation.objects.filter(pk=invitation.pk).update(
            expires_at=timezone.now() - timedelta(days=1)
        )

        with django_capture_on_commit_callbacks(execute=True):
            response = admin_client.post(f"{URL}invitations/{invitation.pk}/resend/")

        assert response.status_code == 200
        invitation.refresh_from_db()
        assert invitation.is_valid
        assert len(mail.outbox) == 2

    def test_the_preview_is_the_mail(self, admin_client):
        response = admin_client.get(f"{URL}invitation-preview/?first_name=Anna")
        assert response.status_code == 200
        assert response.data["body"].startswith("Hej Anna,")


class TestMovedOut:
    """A resident who has moved out can log in, but is no longer one of us."""

    @pytest.fixture
    def moved_out(self, house40, old_residents, today):
        handover = _handover(house40, old_residents, today, handover_in=0)
        process_handover(handover.pk, today=today)
        user = old_residents[0]
        user.refresh_from_db()
        return user

    def test_left_out_of_the_directory_mentions_and_birthdays(
        self, authenticated_client, moved_out, today
    ):
        moved_out.birthdate = today.replace(year=1980)
        moved_out.save()

        listed = authenticated_client.get("/api/users/").data
        ids = {u["id"] for u in (listed["results"] if isinstance(listed, dict) else listed)}
        assert moved_out.pk not in ids
        mentions = authenticated_client.get("/api/users/mentions/").data
        assert moved_out.pk not in {u["id"] for u in mentions}
        birthdays = authenticated_client.get("/api/users/birthdays/").data
        assert moved_out.pk not in {b["id"] for b in birthdays}
        # Their profile still opens, from the posts they wrote.
        profile = authenticated_client.get(f"/api/users/{moved_out.pk}/")
        assert profile.status_code == 200
        assert profile.data["moved_out_on"] == today.isoformat()

    def test_they_are_told_until_when_they_have_access(self, api_client, moved_out):
        api_client.force_authenticate(moved_out)
        me = api_client.get("/api/users/me/").data
        assert me["access_until"] == Handover.objects.get().access_until.isoformat()

    def test_only_personal_notifications_reach_them(self, moved_out, user):
        assert (
            create_notification(moved_out, NotificationType.NEW_ANNOUNCEMENT, "Opslag", "...")
            is None
        )
        assert create_notification(moved_out, NotificationType.MENTION, "Omtale", "...")

    def test_back_in_a_house_they_live_here_again(self, moved_out, house2):
        moved_out.house = house2
        moved_out.save(update_fields=["house"])
        moved_out.refresh_from_db()
        assert moved_out.moved_out_on is None


class TestMovingIn:
    @pytest.fixture
    def sent_invitation(self, house40, old_residents, today):
        handover = _handover(house40, old_residents, today, handover_in=0)
        Invitation.objects.filter(handover=handover).update(
            last_name="Beboer", phone_number="12345678"
        )
        process_handover(handover.pk, today=today)
        return Invitation.objects.get()

    def test_the_registration_form_is_filled_in(self, api_client, sent_invitation):
        response = api_client.post(
            "/api/auth/validate-invitation/", {"token": sent_invitation.token}, format="json"
        )
        assert response.data["first_name"] == "Ny"
        assert response.data["last_name"] == "Beboer"

    def test_a_new_resident_starts_with_a_month_off_madhold(
        self, api_client, sent_invitation, today
    ):
        response = api_client.post(
            "/api/auth/register/",
            {
                "token": sent_invitation.token,
                "email": "ny@example.com",
                "password": "EtGodtKodeord123!",
                "password_confirm": "EtGodtKodeord123!",
                "first_name": "Ny",
                "last_name": "Beboer",
            },
            format="json",
        )
        assert response.status_code == 201, response.data
        user = User.objects.get(email="ny@example.com")
        assert user.house == sent_invitation.house
        assert user.phone_number == "12345678"
        assert user.is_exempt_from_food_teams
        assert user.food_team_pause_until == one_month_after(today)
        assert "Ny beboer" in user.food_team_pause_reason


class TestPauseUntil:
    @pytest.fixture
    def paused(self, user_with_house, today):
        user_with_house.is_exempt_from_food_teams = True
        user_with_house.food_team_pause_until = today
        user_with_house.food_team_pause_reason = "Ny beboer"
        user_with_house.save()
        return user_with_house

    def test_the_pause_lifts_itself_on_the_day(self, paused):
        from apps.food.tasks import lift_ended_food_team_pauses

        lift_ended_food_team_pauses.call_local()

        paused.refresh_from_db()
        assert not paused.is_exempt_from_food_teams
        assert paused.food_team_pause_reason == ""
        assert paused.food_team_pause_until is None

    def test_lifting_it_early_drops_the_end_date(self, paused):
        paused.is_exempt_from_food_teams = False
        paused.save(update_fields=["is_exempt_from_food_teams"])
        paused.refresh_from_db()
        assert paused.food_team_pause_until is None

    def test_a_new_reason_is_a_new_pause_without_the_old_end_date(self, paused):
        paused.food_team_pause_reason = "Rejser til foråret"
        paused.save(update_fields=["food_team_pause_reason"])
        paused.refresh_from_db()
        assert paused.is_exempt_from_food_teams
        assert paused.food_team_pause_until is None

    def test_other_changes_keep_the_end_date(self, paused, today):
        paused.phone_number = "87654321"
        paused.save()
        paused.refresh_from_db()
        assert paused.food_team_pause_until == today

    def test_a_wish_taken_back_gives_the_end_date_back(self, api_client, admin_user, paused):
        from django.urls import reverse

        until = paused.food_team_pause_until + timedelta(days=20)
        paused.food_team_pause_until = until
        paused.save()
        cooking_day = until + timedelta(days=7)
        cycle = FoodTeamCycle.objects.create(
            name="P",
            cooking_dates=[cooking_day.isoformat()],
            wish_deadline=timezone.now() + timedelta(days=5),
            status=CycleStatus.COLLECTING_WISHES,
            created_by=admin_user,
        )
        api_client.force_authenticate(user=paused)
        url = reverse("food:my-wish", kwargs={"cycle_id": cycle.id})

        lifted = api_client.post(
            url,
            {"available_dates": [cooking_day.isoformat()], "is_unavailable": False},
            format="json",
        )
        assert lifted.status_code in (200, 201), lifted.data
        paused.refresh_from_db()
        assert paused.food_team_pause_until is None

        taken_back = api_client.post(
            url, {"available_dates": [], "is_unavailable": True, "pause_reason": ""}, format="json"
        )
        assert taken_back.status_code in (200, 201), taken_back.data
        paused.refresh_from_db()
        assert paused.is_exempt_from_food_teams
        assert paused.food_team_pause_reason == "Ny beboer"
        assert paused.food_team_pause_until == until


class TestGeneratorAndLeavers:
    def test_a_leaver_is_only_planned_before_moving(self, admin_user, today):
        from apps.food.services.team_generator import TeamGenerator

        monday = today + timedelta(days=7 - today.weekday() + 7)
        d1, d2 = monday, monday + timedelta(days=1)
        cycle = FoodTeamCycle.objects.create(
            name="P",
            cooking_dates=[d1.isoformat(), d2.isoformat()],
            wish_deadline=timezone.now() + timedelta(days=1),
            status=CycleStatus.COLLECTING_WISHES,
            created_by=admin_user,
        )
        cooks = []
        for i in range(12):
            house = House.objects.create(name=f"Gen House {i}")
            cooks.append(
                User.objects.create_user(
                    email=f"kok{i}@example.com",
                    password="x",
                    first_name=f"Kok{i}",
                    house=house,
                    can_be_head_chef=(i % 3 == 0),
                )
            )
        leaver = cooks[1]
        handover = Handover.objects.create(
            house=leaver.house, handover_date=d2, invite_on=d2, access_until=d2
        )
        handover.outgoing.set([leaver])

        result = TeamGenerator(cycle).generate(save=True)

        dates = set(FoodTeamMember.objects.filter(user=leaver).values_list("team__date", flat=True))
        assert d2 not in dates
        assert any("flytter" in w for w in result.warnings)

    def test_someone_gone_before_the_period_is_not_asked_or_counted(
        self, admin_user, house40, old_residents, today
    ):
        from apps.food.services.cycle_planning import eligible_food_team_count
        from apps.food.tasks import notify_residents_of_new_cycle
        from apps.food.utils import food_team_pool
        from apps.notifications.models import Notification

        start = today + timedelta(days=14)
        leaver, stayer = old_residents
        handover = Handover.objects.create(
            house=house40, handover_date=start, invite_on=start, access_until=start
        )
        handover.outgoing.set([leaver])

        assert set(food_team_pool(start)) == {stayer}
        # Moving after the first day, they can still cook before they go.
        assert set(food_team_pool(start - timedelta(days=1))) == {leaver, stayer}
        assert eligible_food_team_count(start) == 1

        cycle = FoodTeamCycle.objects.create(
            name="P",
            cooking_dates=[start.isoformat()],
            wish_deadline=timezone.now() + timedelta(days=5),
            status=CycleStatus.COLLECTING_WISHES,
            created_by=admin_user,
        )
        notify_residents_of_new_cycle.call_local(cycle.id)
        told = set(Notification.objects.values_list("user_id", flat=True))
        assert stayer.pk in told
        assert leaver.pk not in told


def test_one_month_after_keeps_to_the_shorter_month():
    assert one_month_after(date(2026, 1, 31)) == date(2026, 2, 28)
    assert one_month_after(date(2026, 12, 15)) == date(2027, 1, 15)
