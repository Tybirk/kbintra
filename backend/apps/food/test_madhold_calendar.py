"""The calendar downloads on Mine hold."""

from datetime import date, timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.food.models import CycleStatus, FoodTeam, FoodTeamCycle, FoodTeamMember
from apps.users.models import User


@pytest.fixture
def cook(db, house):
    return User.objects.create_user(
        email="kok@example.com", password="x", first_name="Søren", last_name="Kok", house=house
    )


@pytest.fixture
def team_on(db, admin_user):
    """Make a team on a date, or ``today + days``, with the given cooks."""
    cycle = FoodTeamCycle.objects.create(
        name="P",
        cooking_dates=[],
        wish_deadline=timezone.now(),
        status=CycleStatus.FINALIZED,
        created_by=admin_user,
    )

    def make(when, *cooks):
        day = when if isinstance(when, date) else timezone.localdate() + timedelta(days=when)
        team = FoodTeam.objects.create(cycle=cycle, date=day)
        for person in cooks:
            FoodTeamMember.objects.create(team=team, user=person)
        return team

    return make


def _all_days(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client.get(reverse("food:my-teams-ical"))


def _one_day(api_client, user, team):
    api_client.force_authenticate(user=user)
    return api_client.get(reverse("food:my-team-ical", kwargs={"pk": team.pk}))


def _unfolded(response) -> list[str]:
    return response.content.decode().replace("\r\n ", "").split("\r\n")


def _starts(response) -> list[str]:
    return [line for line in _unfolded(response) if line.startswith("DTSTART")]


@pytest.mark.django_db
class TestMyTeamsCalendar:
    def test_it_is_a_calendar_file_to_download(self, api_client, cook, team_on):
        team_on(3, cook)

        response = _all_days(api_client, cook)

        assert response.status_code == 200
        assert response["Content-Type"] == "text/calendar; charset=utf-8"
        assert response["Content-Disposition"] == 'attachment; filename="madhold.ics"'
        lines = _unfolded(response)
        assert lines[0] == "BEGIN:VCALENDAR"
        assert lines[-2:] == ["END:VCALENDAR", ""]

    @pytest.mark.parametrize(
        ("day", "start", "end"),
        [
            pytest.param(date(2099, 7, 6), "20990706T130000Z", "20990706T180000Z", id="summer"),
            pytest.param(date(2099, 1, 5), "20990105T140000Z", "20990105T190000Z", id="winter"),
        ],
    )
    def test_a_maddag_runs_from_15_to_20_danish_time(
        self, api_client, cook, team_on, day, start, end
    ):
        team_on(day, cook)

        lines = _unfolded(_all_days(api_client, cook))

        assert f"DTSTART:{start}" in lines
        assert f"DTEND:{end}" in lines
        assert "SUMMARY:Madhold" in lines

    def test_only_my_upcoming_days_are_in_it(self, api_client, cook, house, team_on):
        other = User.objects.create_user(
            email="anden@example.com", password="x", first_name="Anden", house=house
        )
        team_on(0, cook)
        team_on(-1, cook)
        team_on(5, other)

        assert len(_starts(_all_days(api_client, cook))) == 1

    def test_it_names_the_others_on_the_team_but_not_me(self, api_client, cook, house, team_on):
        other = User.objects.create_user(
            email="ib@example.com", password="x", first_name="Ib", last_name="Lund", house=house
        )
        team_on(3, cook, other)

        assert "DESCRIPTION:Sammen med: Ib Lund" in _unfolded(_all_days(api_client, cook))

    def test_a_cook_alone_has_no_description(self, api_client, cook, team_on):
        team_on(3, cook)

        lines = _unfolded(_all_days(api_client, cook))

        assert not any(line.startswith("DESCRIPTION") for line in lines)

    def test_the_uid_stays_the_same_and_differs_per_person(self, api_client, cook, house, team_on):
        partner = User.objects.create_user(
            email="partner@example.com", password="x", first_name="Partner", house=house
        )
        team = team_on(3, cook, partner)

        uid = f"UID:madhold-{team.pk}-{cook.pk}@kbintra"
        assert uid in _unfolded(_all_days(api_client, cook))
        assert uid in _unfolded(_one_day(api_client, cook, team))
        assert uid not in _unfolded(_all_days(api_client, partner))

    def test_long_lines_fold_without_splitting_a_danish_letter(
        self, api_client, cook, house, team_on
    ):
        others = [
            User.objects.create_user(
                email=f"o{i}@example.com",
                password="x",
                first_name="Bjørn-Åge",
                last_name=f"Æbelø{i}, Sønderskov",
                house=house,
            )
            for i in range(6)
        ]
        team_on(3, cook, *others)

        response = _all_days(api_client, cook)

        for line in response.content.split(b"\r\n"):
            assert len(line) <= 75
            line.decode()  # a cut through a two-octet letter raises here
        description = next(line for line in _unfolded(response) if line.startswith("DESCRIPTION"))
        assert description.count("Bjørn-Åge Æbelø") == 6
        assert "Æbelø0\\, Sønderskov" in description

    def test_no_days_is_still_a_valid_empty_calendar(self, api_client, cook):
        lines = _unfolded(_all_days(api_client, cook))

        assert lines[0] == "BEGIN:VCALENDAR"
        assert "BEGIN:VEVENT" not in lines

    def test_it_needs_a_login(self, api_client, db):
        assert api_client.get(reverse("food:my-teams-ical")).status_code == 401


@pytest.mark.django_db
class TestOneDayCalendar:
    def test_a_card_downloads_only_that_day(self, api_client, cook, team_on):
        wanted = team_on(3, cook)
        team_on(4, cook)

        response = _one_day(api_client, cook, wanted)

        assert response.status_code == 200
        assert response["Content-Type"] == "text/calendar; charset=utf-8"
        assert response["Content-Disposition"] == (
            f'attachment; filename="madhold-{wanted.date.isoformat()}.ics"'
        )
        assert len(_starts(response)) == 1

    def test_only_your_own_upcoming_day_can_be_downloaded(self, api_client, cook, house, team_on):
        other = User.objects.create_user(
            email="anden@example.com", password="x", first_name="Anden", house=house
        )

        assert _one_day(api_client, cook, team_on(5, other)).status_code == 404
        assert _one_day(api_client, cook, team_on(-1, cook)).status_code == 404

    def test_it_needs_a_login(self, api_client, cook, team_on):
        team = team_on(3, cook)

        url = reverse("food:my-team-ical", kwargs={"pk": team.pk})
        assert api_client.get(url).status_code == 401
