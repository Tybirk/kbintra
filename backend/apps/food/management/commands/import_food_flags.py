"""
Bring residents' madhold settings in line with the madhold CLI's all_persons.csv.

The organiser keeps who is on pause (and why), who can be head chef and who
cooks with their housemate in that spreadsheet. This command copies those
answers onto the residents, so the app plans and reminds from the same list.

Columns read (by header): Husnummer, Navn, Fritaget, Over 50,
Ønsker at være med medbeboer, Kan være chefkok, Kommentar. "1" means yes, blank
or "0" means no.

- Fritaget -> is_exempt_from_food_teams ("Holder pause").
- Kommentar -> food_team_pause_reason, only for someone on pause. A blank
  comment keeps the reason they may have typed in the app. For anyone not on
  pause the comment is only reported.
- Over 50 -> is_over_50, only for residents without a birthdate; the birthdate
  decides for everyone else (User.is_over_50_effective).
- Names are matched within the house, exactly like import_food_teams. Rows named
  "Ingen", "Ingen1", ... are the sheet's placeholders for an empty house and are
  skipped. Anything else that does not resolve stops the import.

Dry run by default; --apply writes.

    uv run python manage.py import_food_flags /app/data/all_persons.csv
    uv run python manage.py import_food_flags /app/data/all_persons.csv --apply
"""

import csv
import re

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.food.models import FoodTeamMember
from apps.food.roster_matching import match_resident, residents_by_house
from apps.food.utils import house_number_for
from apps.users.models import User

PLACEHOLDER = re.compile(r"^ingen\d*$", re.IGNORECASE)

FIELD_LABELS = {
    "is_exempt_from_food_teams": "holder pause",
    "food_team_pause_reason": "begrundelse",
    "can_be_head_chef": "chefkok",
    "prefers_cooking_with_housemate": "med medbeboer",
    "is_over_50": "over 50",
}


def _yes(value: str | None) -> bool:
    return (value or "").strip() == "1"


class Command(BaseCommand):
    help = "Import madhold settings (pause, chefkok, medbeboer) from all_persons.csv."

    def add_arguments(self, parser) -> None:  # type: ignore[no-untyped-def]
        parser.add_argument("source", type=str, help="Path to all_persons.csv.")
        parser.add_argument("--apply", action="store_true", help="Write the changes.")

    def handle(self, *args, **options) -> None:  # type: ignore[no-untyped-def]
        try:
            with open(options["source"], encoding="utf-8-sig", newline="") as fh:
                rows = list(csv.DictReader(fh))
        except OSError as exc:
            raise CommandError(f"Kunne ikke læse {options['source']}: {exc}") from exc

        required = {"Husnummer", "Navn", "Fritaget", "Kan være chefkok"}
        if not rows or not required <= set(rows[0]):
            raise CommandError(f"Filen mangler kolonnerne {', '.join(sorted(required))}.")

        by_house = residents_by_house()
        problems: list[str] = []
        notes: list[str] = []
        changes: list[tuple[User, dict[str, object]]] = []
        seen: set[int] = set()

        for lineno, row in enumerate(rows, start=2):
            name = (row.get("Navn") or "").strip()
            house = (row.get("Husnummer") or "").strip()
            if not name or PLACEHOLDER.match(name):
                continue

            user, note = match_resident(name, house, by_house)
            if user is None:
                problems.append(f"Linje {lineno} — {name} ({house}): {note}")
                continue
            full = f"{user.first_name} {user.last_name}".strip()
            if note:
                notes.append(note.replace("{full}", full))
            if user.id in seen:
                problems.append(f"Linje {lineno} — {name} ({house}): {full} står to gange.")
                continue
            seen.add(user.id)

            exempt = _yes(row.get("Fritaget"))
            comment = (row.get("Kommentar") or "").strip()
            wanted: dict[str, object] = {
                "is_exempt_from_food_teams": exempt,
                "can_be_head_chef": _yes(row.get("Kan være chefkok")),
                "prefers_cooking_with_housemate": _yes(row.get("Ønsker at være med medbeboer")),
            }
            if exempt and comment:
                wanted["food_team_pause_reason"] = comment
            elif comment:
                notes.append(f"{full}: kommentaren {comment!r} gemmes ikke (holder ikke pause)")
            if user.birthdate is None and "Over 50" in row:
                wanted["is_over_50"] = _yes(row.get("Over 50"))

            diff = {f: v for f, v in wanted.items() if getattr(user, f) != v}
            if diff:
                changes.append((user, diff))

        for note in notes:
            self.stdout.write(self.style.WARNING(f"  tolket: {note}"))
        if problems:
            for problem in problems:
                self.stdout.write(self.style.ERROR(f"  {problem}"))
            raise CommandError(
                f"{len(problems)} navn(e) kunne ikke slås entydigt op. Intet er ændret."
            )

        self.stdout.write(self.style.SUCCESS(f"Alle {len(seen)} navne blev slået entydigt op."))

        missing = [
            u for users in by_house.values() for u in users if u.id not in seen and not u.is_staff
        ]
        if missing:
            names = ", ".join(
                f"{u.first_name} ({house_number_for(u.house)})"
                for u in sorted(missing, key=lambda u: u.first_name)
            )
            self.stdout.write(
                self.style.WARNING(
                    f"  {len(missing)} beboere står ikke i listen (uændret): {names}"
                )
            )

        # Pausing someone who already has upcoming cooking days does not take
        # them off those teams; the organiser needs to know to find a stand-in.
        pausing = [u.id for u, diff in changes if diff.get("is_exempt_from_food_teams") is True]
        for member in FoodTeamMember.objects.filter(
            user_id__in=pausing, team__date__gte=timezone.localdate()
        ).select_related("user", "team"):
            self.stdout.write(
                self.style.WARNING(
                    f"  OBS: {member.user.first_name} sættes på pause, men står på "
                    f"holdet {member.team.date}. Find en afløser."
                )
            )

        self.stdout.write("")
        for user, diff in changes:
            parts = ", ".join(f"{FIELD_LABELS[f]} → {v!r}" for f, v in diff.items())
            self.stdout.write(f"  {user.first_name} ({house_number_for(user.house)}): {parts}")
        self.stdout.write(f"{len(changes)} beboere får ændret indstillinger.")

        if not options["apply"]:
            self.stdout.write(self.style.WARNING("Tør-kørsel: intet er gemt. Kør med --apply."))
            return

        with transaction.atomic():
            for user, diff in changes:
                for field, value in diff.items():
                    setattr(user, field, value)
                user.save(update_fields=list(diff))
        self.stdout.write(self.style.SUCCESS(f"Gemt for {len(changes)} beboere."))
