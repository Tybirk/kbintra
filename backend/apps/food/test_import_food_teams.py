"""Tests for the ``import_food_teams`` command (the published plan -> the app)."""

from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.food.models import CycleStatus, FoodTeam, FoodTeamCycle, FoodTeamMember
from apps.houses.models import House
from apps.users.models import User

# 24/8 and 25/8 2026 really are a Monday and a Tuesday.
ROSTER = """     Dato                        Madhold

Mandag 24/8    Jonas (9), Helge (43), Deni (46), HC (47), Phillip (18), Anne (43)

Tirsdag 25/8   Merete (11), Lotte (21), Carl (1), Eva (20), Gro (30), Niels (11)
"""


def _resident(first_name: str, house: House, last_name: str = "Testesen") -> User:
    return User.objects.create_user(
        email=f"{first_name.replace(' ', '.').lower()}.{last_name.lower()}.{house.slug}@example.com",
        password="x",
        first_name=first_name,
        last_name=last_name,
        house=house,
    )


@pytest.fixture
def community(db):
    """The residents the roster above refers to, with their registered names."""
    houses = {
        n: House.objects.create(name=f"Kløverbakkevej {n}")
        for n in (9, 43, 46, 47, 18, 11, 21, 1, 20, 30)
    }
    people = {
        "jonas": _resident("Jonas", houses[9]),
        "helge": _resident("Helge Kjær", houses[43]),  # first word
        "anne": _resident("Anne", houses[43]),
        "deni": _resident("Denitza", houses[46]),  # shortening
        "hc": _resident("Hans Christian", houses[47]),  # initials
        "phillip": _resident("Philip", houses[18]),  # spelling
        "merete": _resident("Merete Aaby", houses[11]),
        "niels": _resident("Niels Harton", houses[11]),
        "lotte": _resident("Lotte Schreiber", houses[21]),
        "carl": _resident("Carl MM", houses[1]),
        "eva": _resident("Eva Aaby", houses[20]),
        "gro": _resident("Gro Lykke", houses[30]),
    }
    return houses, people


def _run(source: str, **kwargs) -> str:
    out = StringIO()
    call_command("import_food_teams", source, year=2026, stdout=out, stderr=out, **kwargs)
    return out.getvalue()


def _run_failing(source: str, **kwargs) -> str:
    """Run an import that must fail; return what it printed before giving up."""
    out = StringIO()
    with pytest.raises(CommandError):
        call_command("import_food_teams", source, year=2026, stdout=out, stderr=out, **kwargs)
    return out.getvalue()


@pytest.mark.django_db
class TestImportFoodTeams:
    def test_it_imports_the_published_plan(self, community, tmp_path):
        _houses, people = community
        path = tmp_path / "roster.txt"
        path.write_text(ROSTER, encoding="utf-8")

        output = _run(str(path))

        assert "Alle 12 navne" in output
        cycle = FoodTeamCycle.objects.get()
        assert cycle.status == CycleStatus.FINALIZED
        assert cycle.cooking_dates == ["2026-08-24", "2026-08-25"]
        assert FoodTeam.objects.count() == 2

        monday = FoodTeam.objects.get(date="2026-08-24")
        assert monday.members.count() == 6
        assert people["helge"].id in {m.user_id for m in monday.members.all()}
        # The house number shown next to a name is the bare number.
        assert monday.members.get(user=people["helge"]).house_number == "43"

    def test_short_and_misspelt_names_resolve_within_the_house(self, community, tmp_path):
        """Registered names are longer than the ones on the noticeboard."""
        _houses, people = community
        path = tmp_path / "roster.txt"
        path.write_text(ROSTER, encoding="utf-8")

        output = _run(str(path))

        monday = FoodTeam.objects.get(date="2026-08-24")
        on_monday = {m.user_id for m in monday.members.all()}
        assert people["deni"].id in on_monday  # Deni -> Denitza
        assert people["hc"].id in on_monday  # HC -> Hans Christian
        assert people["phillip"].id in on_monday  # Phillip -> Philip
        assert "tolket" in output

    def test_a_name_nobody_in_the_house_has_stops_the_import(self, community, tmp_path):
        path = tmp_path / "roster.txt"
        path.write_text("Mandag 24/8   Jonas (9), Ukendt (43)\n", encoding="utf-8")

        with pytest.raises(CommandError, match="kunne ikke slås entydigt op"):
            _run(str(path))

        assert FoodTeam.objects.count() == 0
        assert FoodTeamCycle.objects.count() == 0

    def test_two_people_of_the_same_name_in_a_house_stop_the_import(self, community, tmp_path):
        _houses, _people = community
        _resident("Jonas", House.objects.get(slug="9"), last_name="Anden")
        path = tmp_path / "roster.txt"
        path.write_text("Mandag 24/8   Jonas (9)\n", encoding="utf-8")

        output = _run_failing(str(path))

        assert "flere i hus 9" in output

    def test_the_same_cook_twice_stops_the_import(self, community, tmp_path):
        path = tmp_path / "roster.txt"
        path.write_text(
            "Mandag 24/8   Jonas (9)\nTirsdag 25/8   Jonas (9)\n",
            encoding="utf-8",
        )

        output = _run_failing(str(path))

        assert "står allerede" in output
        assert FoodTeam.objects.count() == 0

    def test_a_wrong_year_is_caught_by_the_weekday(self, community, tmp_path):
        """24/8 is a Monday in 2026 but not in 2025 — say so instead of importing."""
        path = tmp_path / "roster.txt"
        path.write_text("Mandag 24/8   Jonas (9)\n", encoding="utf-8")
        out = StringIO()

        with pytest.raises(CommandError, match="Er --year 2025 rigtigt"):
            call_command("import_food_teams", str(path), year=2025, stdout=out)

    def test_dry_run_writes_nothing(self, community, tmp_path):
        path = tmp_path / "roster.txt"
        path.write_text(ROSTER, encoding="utf-8")

        output = _run(str(path), dry_run=True)

        assert "intet er gemt" in output
        assert FoodTeam.objects.count() == 0
        assert FoodTeamCycle.objects.count() == 0

    def test_existing_teams_are_kept_unless_replace_is_given(self, community, tmp_path):
        from datetime import date

        FoodTeam.objects.create(date=date(2026, 8, 24))
        path = tmp_path / "roster.txt"
        path.write_text(ROSTER, encoding="utf-8")

        with pytest.raises(CommandError, match="--replace"):
            _run(str(path))

        output = _run(str(path), replace=True)
        assert "Alle 12 navne" in output
        assert FoodTeam.objects.get(date="2026-08-24").members.count() == 6
        # The old, member-less team was replaced rather than duplicated.
        assert FoodTeam.objects.filter(date="2026-08-24").count() == 1

    def test_rerunning_updates_the_same_cycle(self, community, tmp_path):
        path = tmp_path / "roster.txt"
        path.write_text(ROSTER, encoding="utf-8")

        _run(str(path))
        _run(str(path), replace=True)

        assert FoodTeamCycle.objects.count() == 1
        assert FoodTeam.objects.count() == 2
        assert FoodTeamMember.objects.count() == 12
