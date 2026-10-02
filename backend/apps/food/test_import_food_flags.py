"""Tests for the ``import_food_flags`` command (all_persons.csv -> residents)."""

import datetime as dt
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.food.models import CycleStatus, FoodTeam, FoodTeamCycle, FoodTeamMember
from apps.houses.models import House
from apps.users.models import User

HEADER = (
    "Husnummer,Navn,Fritaget,Over 50,Ønsker at være med medbeboer,Kan være chefkok,"
    "Kommentar,Total kokke,Antal maddage per cyklus\n"
)


def _resident(first_name: str, house: House, **extra) -> User:
    return User.objects.create_user(
        email=f"{first_name.lower()}.{house.slug}@example.com",
        password="x",
        first_name=first_name,
        last_name="Testesen",
        house=house,
        **extra,
    )


@pytest.fixture
def houses(db):
    return {n: House.objects.create(name=f"Kløverbakkevej {n}") for n in (1, 22, 43, 51)}


def _csv(tmp_path, body: str) -> str:
    path = tmp_path / "all_persons.csv"
    path.write_text(HEADER + body, encoding="utf-8")
    return str(path)


def _run(path: str, **kwargs) -> str:
    out = StringIO()
    call_command("import_food_flags", path, stdout=out, stderr=out, **kwargs)
    return out.getvalue()


def test_dry_run_reports_but_writes_nothing(houses, tmp_path):
    alma = _resident("Alma", houses[1])
    out = _run(_csv(tmp_path, "1,Alma,1,0,,,Barsel,,\n"))

    assert "holder pause → True" in out
    alma.refresh_from_db()
    assert alma.is_exempt_from_food_teams is False


def test_apply_sets_pause_reason_chef_and_housemate(houses, tmp_path):
    alma = _resident("Alma", houses[1])
    bertil = _resident("Bertil Bo", houses[43], birthdate=dt.date(1950, 1, 1))
    cecilie = _resident("Cecilie", houses[43])
    path = _csv(
        tmp_path,
        "1,Alma,1,0,,,Barsel,,\n43,Bertil,,0,1,,,,\n43,Cecilie,,1,1,1,,,\n",
    )

    _run(path, apply=True)

    for u in (alma, bertil, cecilie):
        u.refresh_from_db()
    assert alma.is_exempt_from_food_teams is True
    assert alma.food_team_pause_reason == "Barsel"
    assert bertil.prefers_cooking_with_housemate is True
    assert cecilie.can_be_head_chef is True and cecilie.prefers_cooking_with_housemate is True
    # Cecilie has no birthdate, so the sheet decides; Bertil's birthdate wins over "0".
    assert cecilie.is_over_50 is True
    assert bertil.is_over_50 is False
    # Idempotent: a second run has nothing left to change.
    assert "0 beboere får ændret" in _run(path)


def test_blank_comment_keeps_reason_typed_in_the_app(houses, tmp_path):
    dorte = _resident(
        "Dorte", houses[51], is_exempt_from_food_teams=True, food_team_pause_reason="Rejse"
    )
    _run(_csv(tmp_path, "51,Dorte,1,1,,,,,\n"), apply=True)

    dorte.refresh_from_db()
    assert dorte.food_team_pause_reason == "Rejse"


def test_comment_without_pause_is_not_stored(houses, tmp_path):
    egon = _resident("Egon", houses[1])
    out = _run(_csv(tmp_path, "1,Egon,,0,1,,MIDLERTIDIGT?,,\n"), apply=True)

    egon.refresh_from_db()
    assert egon.food_team_pause_reason == ""
    assert "gemmes ikke" in out


def test_placeholders_are_skipped_and_unknown_names_stop_everything(houses, tmp_path):
    alma = _resident("Alma", houses[1])
    path = _csv(tmp_path, "22,Ingen1,1,0,,,,,\n1,Alma,1,0,,,,,\n1,Frida,,0,,,,,\n")

    with pytest.raises(CommandError):
        _run(path, apply=True)

    alma.refresh_from_db()
    assert alma.is_exempt_from_food_teams is False


def test_warns_when_pausing_someone_with_an_upcoming_shift(houses, tmp_path):
    alma = _resident("Alma", houses[1])
    cycle = FoodTeamCycle.objects.create(
        name="Test",
        cooking_dates=[],
        wish_deadline=dt.datetime(2030, 1, 1, tzinfo=dt.UTC),
        status=CycleStatus.FINALIZED,
    )
    team = FoodTeam.objects.create(cycle=cycle, date=dt.date.today() + dt.timedelta(days=3))
    FoodTeamMember.objects.create(team=team, user=alma, house_number="1")

    out = _run(_csv(tmp_path, "1,Alma,1,0,,,,,\n"))

    assert "Find en afløser" in out
