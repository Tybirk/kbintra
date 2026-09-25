"""
Import an already-decided food-team plan from the list we publish as a PDF.

The teams for a period are still put together outside the app (the standalone
madhold CLI writes an Excel/PDF that goes on the noticeboard). This command
takes that same list and makes it the app's plan, so residents see the real
teams instead of a generated stand-in.

Feed it the plain text of the PDF -- ``pdftotext -layout madhold.pdf -`` puts it
in exactly the expected shape, and a hand-typed list works just as well:

    Mandag 24/8    Jonas (9), Anne (43), Helge (43), Lasse (8)
    Tirsdag 25/8   Anders (6), Elisabeth (8), Ditte-Marie (31)

Each cook is "<fornavn> (<husnummer>)". The name is matched inside that house
only, which is what makes short forms safe: the roster says "Helge (43)" where
the resident is registered as "Helge Kjær", and house 43 has exactly one Helge.
Anything the matcher cannot pin down to a single person is reported and stops
the import -- putting the wrong resident on a cooking team is worse than
failing.

Example:
    pdftotext -layout madhold-august-september-2026.pdf - \
        | uv run python manage.py import_food_teams - --year 2026 --dry-run
"""

import difflib
import re
import sys
from datetime import date, datetime, timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.food.models import (
    CycleStatus,
    FoodTeam,
    FoodTeamCycle,
    FoodTeamMember,
)
from apps.food.utils import house_number_for
from apps.users.models import User

WEEKDAYS_DA = {
    "mandag": 0,
    "tirsdag": 1,
    "onsdag": 2,
    "torsdag": 3,
    "fredag": 4,
    "lørdag": 5,
    "søndag": 6,
}

MONTHS_DA = [
    "januar",
    "februar",
    "marts",
    "april",
    "maj",
    "juni",
    "juli",
    "august",
    "september",
    "oktober",
    "november",
    "december",
]

YEAR_LINE = re.compile(r"^#\s*(?:år|aar|year)\s*:\s*(\d{4})\s*$", re.IGNORECASE)

DAY_LINE = re.compile(
    r"^(mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)\s+(\d{1,2})\s*/\s*(\d{1,2})\s+(.*)$",
    re.IGNORECASE,
)
COOK = re.compile(r"^(.+?)\s*\(\s*([^)]+?)\s*\)$")


class Command(BaseCommand):
    help = "Import a decided food-team plan from the published list (text or '-' for stdin)."

    def add_arguments(self, parser) -> None:  # type: ignore[no-untyped-def]
        parser.add_argument(
            "source",
            type=str,
            help="Path to the roster text file, or '-' to read stdin.",
        )
        parser.add_argument(
            "--year",
            type=int,
            default=None,
            help=(
                "Calendar year the day/month dates belong to (the list omits it). "
                "May instead be written in the file as a '# år: 2026' header line, "
                "which is what lets an unattended re-import stay correct."
            ),
        )
        parser.add_argument(
            "--name",
            type=str,
            default="",
            help="Cycle name (defaults to a Danish month range over the dates).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Resolve and report every name, but write nothing.",
        )
        parser.add_argument(
            "--skip-if-past",
            action="store_true",
            help=(
                "Exit quietly instead of importing when the last cooking date has "
                "already passed. For unattended re-imports, so an old plan is not "
                "resurrected forever."
            ),
        )
        parser.add_argument(
            "--replace",
            action="store_true",
            help="Required to overwrite teams that already exist on these dates.",
        )

    # ---- parsing ---------------------------------------------------------- #

    def _parse(self, text: str, year: int) -> list[tuple[date, list[tuple[str, str]]]]:
        """Turn the roster text into [(date, [(name, house_number), ...]), ...]."""
        days: list[tuple[date, list[tuple[str, str]]]] = []
        seen: set[date] = set()

        for lineno, raw in enumerate(text.splitlines(), start=1):
            line = raw.strip()
            m = DAY_LINE.match(line)
            if not m:
                continue

            weekday_name, day, month, rest = (
                m.group(1),
                int(m.group(2)),
                int(m.group(3)),
                m.group(4),
            )
            try:
                d = date(year, month, day)
            except ValueError as exc:
                raise CommandError(
                    f"Linje {lineno}: ugyldig dato {day}/{month} {year}: {exc}"
                ) from exc

            # The weekday is written out, so use it to catch a wrong --year:
            # the same day/month falls on a different weekday in another year.
            expected = WEEKDAYS_DA[weekday_name.lower()]
            if d.weekday() != expected:
                actual = [k for k, v in WEEKDAYS_DA.items() if v == d.weekday()][0]
                raise CommandError(
                    f"Linje {lineno}: listen siger {weekday_name.lower()} {day}/{month}, "
                    f"men i {year} er den dato en {actual}. Er --year {year} rigtigt?"
                )

            if d in seen:
                raise CommandError(f"Linje {lineno}: datoen {d} står to gange i listen.")
            seen.add(d)

            cooks: list[tuple[str, str]] = []
            for chunk in rest.split(","):
                chunk = chunk.strip()
                if not chunk:
                    continue
                cm = COOK.match(chunk)
                if not cm:
                    raise CommandError(
                        f"Linje {lineno}: kunne ikke læse {chunk!r}. "
                        f"Forventer 'Fornavn (husnummer)'."
                    )
                cooks.append((cm.group(1).strip(), cm.group(2).strip()))

            if not cooks:
                raise CommandError(f"Linje {lineno}: ingen kokke på {d}.")
            days.append((d, cooks))

        if not days:
            raise CommandError(
                "Fandt ingen maddage i teksten. Hver linje skal se ud som "
                "'Mandag 24/8   Jonas (9), Anne (43), ...'."
            )
        return sorted(days, key=lambda pair: pair[0])

    # ---- matching --------------------------------------------------------- #

    def _match(self, name: str, house_number: str, by_house: dict) -> tuple[User | None, str]:
        """Find the one resident in ``house_number`` that ``name`` refers to.

        Returns (user, note); user is None when nobody or several people fit.
        Everything is decided within the house, so tolerant tiers stay safe:
        houses hold a handful of adults, not ninety.
        """
        candidates = by_house.get(house_number, [])
        if not candidates:
            return None, f"hus {house_number} findes ikke, eller har ingen beboere"

        wanted = name.casefold()

        def pick(matches: list[User], note: str) -> tuple[User | None, str] | None:
            if len(matches) == 1:
                return matches[0], note
            if len(matches) > 1:
                names = ", ".join(f"{u.first_name} {u.last_name}".strip() for u in matches)
                return None, f"flere i hus {house_number} passer på {name!r}: {names}"
            return None

        # 1. The whole registered first name, exactly.
        if hit := pick([u for u in candidates if u.first_name.casefold() == wanted], ""):
            return hit

        # 2. The first word of it -- "Helge Kjær" is called Helge on the list.
        first_word = [u for u in candidates if u.first_name.casefold().split()[:1] == [wanted]]
        if hit := pick(first_word, f"{name} → {{full}}"):
            return hit

        # 3. A shortening of it: "Deni" for "Denitza".
        prefix = [u for u in candidates if u.first_name.casefold().startswith(wanted)]
        if hit := pick(prefix, f"{name} → {{full}}"):
            return hit

        # 4. Initials: "HC" for "Hans Christian".
        if wanted.isalpha() and 1 < len(wanted) <= 3:
            initials = [
                u
                for u in candidates
                if "".join(w[0] for w in u.first_name.casefold().split() if w) == wanted
            ]
            if hit := pick(initials, f"{name} → {{full}} (initialer)"):
                return hit

        # 5. Spelling variants: "Phillip" for "Philip".
        close = difflib.get_close_matches(
            wanted, [u.first_name.casefold() for u in candidates], n=2, cutoff=0.8
        )
        if len(close) == 1:
            matched = [u for u in candidates if u.first_name.casefold() == close[0]]
            if hit := pick(matched, f"{name} → {{full}} (stavemåde)"):
                return hit

        living = ", ".join(f"{u.first_name} {u.last_name}".strip() for u in candidates)
        return None, f"ingen i hus {house_number} hedder {name!r}. Huset har: {living}"

    def _default_name(self, dates: list[date]) -> str:
        first, last = dates[0], dates[-1]
        if first.month == last.month:
            return f"Madhold {MONTHS_DA[first.month - 1]} {first.year}"
        span = f"{MONTHS_DA[first.month - 1]}/{MONTHS_DA[last.month - 1]}"
        if first.year != last.year:
            return f"Madhold {MONTHS_DA[first.month - 1]} {first.year}/{MONTHS_DA[last.month - 1]} {last.year}"
        return f"Madhold {span} {first.year}"

    # ---- command ---------------------------------------------------------- #

    def handle(self, *args, **options) -> None:  # type: ignore[no-untyped-def]
        source: str = options["source"]
        year: int = options["year"]
        dry_run: bool = options["dry_run"]
        replace: bool = options["replace"]
        skip_if_past: bool = options["skip_if_past"]

        if source == "-":
            text = sys.stdin.read()
        else:
            try:
                with open(source, encoding="utf-8") as fh:
                    text = fh.read()
            except OSError as exc:
                raise CommandError(f"Kunne ikke læse {source}: {exc}") from exc

        if year is None:
            header = next(
                (m.group(1) for line in text.splitlines() if (m := YEAR_LINE.match(line.strip()))),
                None,
            )
            if header is None:
                raise CommandError(
                    "Årstallet mangler. Angiv --year, eller skriv en linje "
                    "'# år: 2026' øverst i listen."
                )
            year = int(header)

        days = self._parse(text, year)
        dates = [d for d, _ in days]
        self.stdout.write(
            f"Læste {len(days)} maddage fra {dates[0]} til {dates[-1]} "
            f"({sum(len(c) for _, c in days)} pladser)."
        )

        # An unattended re-import (deploy-test.sh) must not keep resurrecting a
        # period that is over. Checked after parsing so a broken list is still
        # reported rather than silently skipped.
        if skip_if_past and dates[-1] < timezone.localdate():
            self.stdout.write(
                self.style.WARNING(
                    f"Sidste maddag ({dates[-1]}) er passeret; importerer ikke. "
                    f"Læg en ny liste hvis perioden skal opdateres."
                )
            )
            return

        # Everyone we could possibly mean, grouped by the number on their house.
        by_house: dict[str, list[User]] = {}
        for user in User.objects.filter(is_active=True).select_related("house"):
            by_house.setdefault(house_number_for(user.house), []).append(user)

        resolved: dict[date, list[User]] = {}
        problems: list[str] = []
        notes: list[str] = []
        assigned_dates: dict[int, date] = {}

        for d, cooks in days:
            resolved[d] = []
            for name, house_number in cooks:
                user, note = self._match(name, house_number, by_house)
                if user is None:
                    problems.append(f"{d} — {name} ({house_number}): {note}")
                    continue
                if note:
                    notes.append(
                        f"{d} — "
                        + note.replace("{full}", f"{user.first_name} {user.last_name}".strip())
                    )
                if user.id in assigned_dates:
                    problems.append(
                        f"{d} — {name} ({house_number}): {user.first_name} står allerede "
                        f"på {assigned_dates[user.id]}."
                    )
                    continue
                assigned_dates[user.id] = d
                resolved[d].append(user)

        for note in notes:
            self.stdout.write(self.style.WARNING(f"  tolket: {note}"))

        if problems:
            self.stdout.write("")
            for problem in problems:
                self.stdout.write(self.style.ERROR(f"  {problem}"))
            raise CommandError(
                f"{len(problems)} navn(e) kunne ikke slås entydigt op. Ingen hold er "
                f"importeret. Ret listen eller navnene i beboeroversigten og prøv igen."
            )

        self.stdout.write(
            self.style.SUCCESS(f"Alle {len(assigned_dates)} navne blev slået entydigt op.")
        )

        clashes = FoodTeam.objects.filter(date__in=dates)
        if clashes.exists() and not (replace or dry_run):
            existing = ", ".join(str(t.date) for t in clashes.order_by("date")[:5])
            raise CommandError(
                f"Der findes allerede hold på {clashes.count()} af datoerne ({existing}...). "
                f"Kør med --replace for at erstatte dem."
            )

        if dry_run:
            self.stdout.write("")
            for d in dates:
                names = ", ".join(
                    f"{u.first_name} ({house_number_for(u.house)})" for u in resolved[d]
                )
                self.stdout.write(f"  {d}: {names}")
            self.stdout.write("")
            self.stdout.write(self.style.WARNING("--dry-run: intet er gemt."))
            return

        cycle_name = options["name"] or self._default_name(dates)

        with transaction.atomic():
            # The plan is already decided, so the cycle is finalized on arrival;
            # the wish deadline is only meaningful before that, and it is a
            # required field, so anchor it to the day the cooking starts.
            deadline = timezone.make_aware(
                datetime.combine(dates[0] - timedelta(days=1), datetime.min.time())
            )
            cycle, created = FoodTeamCycle.objects.update_or_create(
                name=cycle_name,
                defaults={
                    "cooking_dates": [d.isoformat() for d in dates],
                    "wish_deadline": deadline,
                    "status": CycleStatus.FINALIZED,
                },
            )
            # FoodTeam.date is unique across cycles, so clear by date rather than
            # by cycle -- a date may currently belong to some other cycle.
            FoodTeam.objects.filter(date__in=dates).delete()

            for d in dates:
                team = FoodTeam.objects.create(cycle=cycle, date=d)
                FoodTeamMember.objects.bulk_create(
                    [
                        FoodTeamMember(
                            team=team,
                            user=user,
                            house_number=house_number_for(user.house),
                        )
                        for user in resolved[d]
                    ]
                )

        self.stdout.write(
            self.style.SUCCESS(
                f"{'Oprettede' if created else 'Opdaterede'} perioden {cycle_name!r} "
                f"med {len(dates)} hold og {len(assigned_dates)} kokke."
            )
        )
