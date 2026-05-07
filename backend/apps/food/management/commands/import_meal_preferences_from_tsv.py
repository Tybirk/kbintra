"""Import recurring MealPreference rows from a TSV scrape of the legacy spreadsheet.

Expected TSV layout (tab-separated, exported from the shared spreadsheet):

    rows 0-1: blank
    row 2:    day labels  (mandag, tirsdag, onsdag, onsdag, onsdag, torsdag, ...)
    row 3:    audience    (Voksne, Voksne, Voksne, Børn, Voksne, Børn, ...)
    row 4:    variant     (vegetar, 1-11, vegetar, kødfisk, 1-11, ...)
    rows 5+:  data — column 0 is the house number, then 9 portion columns:

        col  0: husnr
        col  1: monday    adults_veg
        col  2: monday    children
        col  3: tuesday   adults_veg
        col  4: tuesday   children
        col  5: wednesday adults_veg
        col  6: wednesday adults_meat   (only on wednesday)
        col  7: wednesday children
        col  8: thursday  adults_veg
        col  9: thursday  children

Houses are matched by the trailing integer in House.name (e.g. "Kløverbakkevej 12" → 12).
Rows with all blank/zero values are skipped (so we don't materialise a "no order" preference
for unoccupied houses — those will fall back to the system default until set explicitly).
"""

import csv
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.food.models import DayOfWeek, MealPreference
from apps.houses.models import House

COLUMNS = {
    DayOfWeek.MONDAY: {"adults_veg": 1, "adults_meat": None, "children": 2},
    DayOfWeek.TUESDAY: {"adults_veg": 3, "adults_meat": None, "children": 4},
    DayOfWeek.WEDNESDAY: {"adults_veg": 5, "adults_meat": 6, "children": 7},
    DayOfWeek.THURSDAY: {"adults_veg": 8, "adults_meat": None, "children": 9},
}


def _to_int(cell: str) -> int:
    cell = cell.strip()
    return int(cell) if cell else 0


class Command(BaseCommand):
    help = (
        "Import recurring MealPreference rows for all houses from a TSV "
        "exported from the legacy 'Mad tilmelding fast' spreadsheet."
    )

    def add_arguments(self, parser):
        parser.add_argument("tsv_path", type=str, help="Path to the .tsv file")
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Parse and report without committing changes.",
        )

    def handle(self, *args, tsv_path, dry_run, **options):
        path = Path(tsv_path).expanduser()
        if not path.exists():
            raise CommandError(f"TSV file not found: {path}")

        with path.open(encoding="utf-8") as f:
            rows = list(csv.reader(f, delimiter="\t"))

        if len(rows) < 6:
            raise CommandError("TSV is too short — expected at least 6 rows.")

        houses_by_number: dict[str, House] = {}
        for h in House.objects.all():
            tail = h.name.rsplit(" ", 1)[-1]
            if tail.isdigit():
                houses_by_number[tail] = h

        created = 0
        updated = 0
        skipped_empty: list[str] = []
        missing_houses: list[str] = []
        per_day_totals = {d: [0, 0, 0] for d in DayOfWeek}  # veg, meat, kids

        with transaction.atomic():
            for r in rows[5:]:
                if len(r) < 10 or not r[0].strip():
                    continue
                husnr = r[0].strip()

                day_values = []
                for day, cols in COLUMNS.items():
                    veg = _to_int(r[cols["adults_veg"]])
                    meat = _to_int(r[cols["adults_meat"]]) if cols["adults_meat"] is not None else 0
                    kids = _to_int(r[cols["children"]])
                    day_values.append((day, veg, meat, kids))

                if all(v == 0 and m == 0 and k == 0 for _, v, m, k in day_values):
                    skipped_empty.append(husnr)
                    continue

                house = houses_by_number.get(husnr)
                if house is None:
                    missing_houses.append(husnr)
                    continue

                for day, veg, meat, kids in day_values:
                    _, was_created = MealPreference.objects.update_or_create(
                        house=house,
                        day_of_week=day,
                        defaults={
                            "adults_veg": veg,
                            "adults_meat": meat,
                            "children_count": kids,
                        },
                    )
                    if was_created:
                        created += 1
                    else:
                        updated += 1
                    per_day_totals[day][0] += veg
                    per_day_totals[day][1] += meat
                    per_day_totals[day][2] += kids

            if dry_run:
                transaction.set_rollback(True)

        prefix = "(dry-run) " if dry_run else ""
        self.stdout.write(self.style.SUCCESS(f"{prefix}Created: {created}  Updated: {updated}"))
        for day in DayOfWeek:
            v, m, k = per_day_totals[day]
            self.stdout.write(
                f"  {day.label:8s}  veg={v:3d}  meat={m:3d}  kids={k:3d}  total={v + m + k:3d}"
            )
        if skipped_empty:
            self.stdout.write(
                f"Skipped {len(skipped_empty)} blank house row(s): {', '.join(skipped_empty)}"
            )
        if missing_houses:
            self.stdout.write(
                self.style.WARNING(f"No matching House for husnr: {', '.join(missing_houses)}")
            )
