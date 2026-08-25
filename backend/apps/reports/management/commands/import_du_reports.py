"""
Import Driftsudvalgets cases from the old reporting app's Excel export.

The export is a plain .xlsx: a single sheet plus the case photos embedded as
floating drawings. We read it with stdlib ``zipfile`` + ``ElementTree`` rather
than adding openpyxl for a one-off — the format we need is three small XML parts.

Run it as:

    uv run python manage.py import_du_reports "~/Downloads/Sager 18-08-2026(1).xlsx"

Idempotent on (subgroup, number): re-running skips cases that already exist, so
it is safe to run again after a fresh export.
"""

from __future__ import annotations

import re
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.reports.models import Report, ReportEvent, ReportPhoto

MAIN_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
DRAW_NS = "{http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing}"
ART_NS = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

KIND_BY_LABEL = {
    "defekt inventar": Report.Kind.DEFECT,
    "fejlbehæftet inventar": Report.Kind.FAULTY,
    "forslag til nyt inventar": Report.Kind.SUGGESTION,
}

STATUS_BY_LABEL = {
    "ny": Report.Status.NEW,
    "i gang": Report.Status.IN_PROGRESS,
    "afventer udvalgsmøde": Report.Status.AWAITING_MEETING,
    "afventer andet": Report.Status.AWAITING_OTHER,
    "afsluttet": Report.Status.DONE,
    "afvist": Report.Status.REJECTED,
}

# Cases that postdate the export and so are not in the file. #13 was filed on
# 21 August, three days after the 18 August extract; its full record is legible
# in the screenshots Terkild posted in forum thread 24126 ("Indrapportering på ny
# intra"). Photos are unknown — the card in that screenshot shows none.
EXTRA_CASES: list[dict[str, Any]] = [
    {
        "number": 13,
        "date": "21-08-2026",
        "kind": "Defekt inventar",
        "description": "OK stander 3 virkede ikke her til aften",
        "name": "Lone",
        "email": "lonesommer14@gmail.com",
        "status": "Afventer andet",
        "link": "",
    },
]


def _cell_text(cell: ET.Element) -> str:
    """Text of one cell, handling both inline strings and plain values."""
    inline = cell.find(f"{MAIN_NS}is")
    if inline is not None:
        return "".join(node.text or "" for node in inline.iter(f"{MAIN_NS}t"))
    value = cell.find(f"{MAIN_NS}v")
    return (value.text or "") if value is not None else ""


def _column_letter(ref: str) -> str:
    """'B7' -> 'B'."""
    match = re.match(r"([A-Z]+)", ref or "")
    return match.group(1) if match else ""


def _field(header: dict[str, str], cells: dict[str, str], name: str) -> str:
    """Value of the column titled *name* in this row."""
    for letter, title in header.items():
        if title.lower() == name.lower():
            return cells.get(letter, "")
    return ""


def _read_rows(archive: zipfile.ZipFile) -> list[tuple[int, dict[str, str]]]:
    """Return [(excel_row_number, {column_letter: text})] for the first sheet."""
    root = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
    rows: list[tuple[int, dict[str, str]]] = []
    for row in root.iter(f"{MAIN_NS}row"):
        number = int(row.get("r") or 0)
        cells = {}
        for cell in row.findall(f"{MAIN_NS}c"):
            letter = _column_letter(cell.get("r") or "")
            if letter:
                cells[letter] = _cell_text(cell).strip()
        rows.append((number, cells))
    return rows


def _read_row_images(archive: zipfile.ZipFile) -> dict[int, str]:
    """Map excel row number -> path of the image anchored to that row.

    The photos are floating drawings rather than cell values, so the only link
    back to a case is the anchor's ``from/row``.
    """
    names = set(archive.namelist())
    if "xl/drawings/drawing1.xml" not in names:
        return {}

    targets: dict[str, str] = {}
    if "xl/drawings/_rels/drawing1.xml.rels" in names:
        rels = ET.fromstring(archive.read("xl/drawings/_rels/drawing1.xml.rels"))
        for rel in rels:
            targets[rel.get("Id") or ""] = rel.get("Target") or ""

    images: dict[int, str] = {}
    root = ET.fromstring(archive.read("xl/drawings/drawing1.xml"))
    for anchor in root:
        origin = anchor.find(f"{DRAW_NS}from")
        if origin is None:
            continue
        row_node = origin.find(f"{DRAW_NS}row")
        if row_node is None or not (row_node.text or "").isdigit():
            continue
        excel_row = int(row_node.text) + 1  # anchors are 0-based
        target = ""
        for blip in anchor.iter(f"{ART_NS}blip"):
            target = targets.get(blip.get(f"{REL_NS}embed") or "", "")
        if not target:
            continue
        # Targets look like "/xl/media/image1.png" or "../media/image1.png".
        path = target.lstrip("/")
        if path.startswith("../"):
            path = "xl/" + path[3:]
        if path in names:
            images[excel_row] = path
    return images


def _normalize_email(value: str) -> str:
    """Lowercase and strip any ``+tag`` from the local part.

    Asger reports as lautrop@gmail.com in the old app but is
    lautrop+kbintra@gmail.com in intra; without this he imports unmatched.
    """
    value = (value or "").strip().lower()
    if "@" not in value:
        return value
    local, domain = value.split("@", 1)
    local = local.split("+", 1)[0]
    return f"{local}@{domain}"


def _parse_date(value: str) -> datetime:
    """'15-08-2026' -> aware datetime at midday local time.

    Midday rather than midnight so the date reads the same in every timezone the
    app might render it in.
    """
    naive = datetime.strptime(value.strip(), "%d-%m-%Y").replace(hour=12)
    return timezone.make_aware(naive)


class Command(BaseCommand):
    help = "Import Driftsudvalgets cases from the old reporting app's .xlsx export."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("path", help="Path to the 'Sager ....xlsx' export.")
        parser.add_argument(
            "--subgroup",
            default="driftsudvalget",
            help="Slug of the udvalg to import into (default: driftsudvalget).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Parse and report what would happen, without writing anything.",
        )
        parser.add_argument(
            "--no-extras",
            action="store_true",
            help="Skip the hand-carried cases that postdate the export (currently #13).",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        from apps.forum.models import Subgroup
        from apps.users.models import User

        path = Path(options["path"]).expanduser()
        if not path.is_file():
            raise CommandError(f"Filen findes ikke: {path}")

        try:
            subgroup = Subgroup.objects.get(slug=options["subgroup"])
        except Subgroup.DoesNotExist as exc:
            raise CommandError(f"Ingen gruppe med slug '{options['subgroup']}'.") from exc
        if not subgroup.reporting_enabled:
            self.stdout.write(
                self.style.WARNING(
                    f"Bemærk: {subgroup.name} har ikke reporting_enabled slået til endnu."
                )
            )

        with zipfile.ZipFile(path) as archive:
            rows = _read_rows(archive)
            row_images = _read_row_images(archive)
            cases = self._collect_cases(rows, row_images)
            if not options["no_extras"]:
                cases.extend(
                    {**extra, "image_path": None, "excel_row": None} for extra in EXTRA_CASES
                )

            # Users, matched on the normalized email.
            by_email = {}
            for user in User.objects.all():
                by_email.setdefault(_normalize_email(user.email), user)

            existing = set(
                Report.objects.filter(subgroup=subgroup).values_list("number", flat=True)
            )

            created = skipped = photos = unmatched = 0
            for case in sorted(cases, key=lambda c: c["number"]):
                number = case["number"]
                if number in existing:
                    skipped += 1
                    self.stdout.write(f"  #{number:<3} findes allerede — sprunget over")
                    continue

                user = by_email.get(_normalize_email(case["email"]))
                if user is None:
                    unmatched += 1
                if case["image_path"]:
                    photos += 1

                who = user.get_full_name() if user else f"{case['name']} (uden bruger)"
                self.stdout.write(
                    f"  #{number:<3} {case['status']:<18} {case['kind']:<24} "
                    f"{who:<26}{'foto' if case['image_path'] else '—'}"
                )

                if not options["dry_run"]:
                    self._import_case(subgroup, case, user, archive)
                created += 1

        verb = "Ville importere" if options["dry_run"] else "Importerede"
        self.stdout.write("")
        self.stdout.write(
            self.style.SUCCESS(
                f"{verb} {created} sager til {subgroup.name} "
                f"({skipped} sprunget over, {photos} med foto, "
                f"{unmatched} uden matchet bruger)."
            )
        )
        highest = max({c["number"] for c in cases} | existing, default=0)
        self.stdout.write(f"Næste nye sag i {subgroup.name} får #{highest + 1}.")

    def _collect_cases(
        self, rows: list[tuple[int, dict[str, str]]], row_images: dict[int, str]
    ) -> list[dict[str, Any]]:
        """Turn sheet rows into case dicts, skipping the header and separators."""
        header: dict[str, str] = {}
        cases: list[dict[str, Any]] = []

        for excel_row, cells in rows:
            if not header:
                # First row that has an "ID" cell is the header.
                if any(v.strip().lower() == "id" for v in cells.values()):
                    header = {letter: value.strip() for letter, value in cells.items()}
                continue

            raw_id = _field(header, cells, "ID")
            if not raw_id.isdigit():
                # The "▲ NYE SAGER SIDEN SIDSTE UDTRÆK / ▼ TIDLIGERE SAGER"
                # separator row, or any other decoration.
                continue

            cases.append(
                {
                    "number": int(raw_id),
                    "date": _field(header, cells, "Dato"),
                    "kind": _field(header, cells, "Kategori"),
                    "description": _field(header, cells, "Beskrivelse"),
                    "name": _field(header, cells, "Navn"),
                    "email": _field(header, cells, "Email"),
                    "status": _field(header, cells, "Status"),
                    "link": _field(header, cells, "Link"),
                    "image_path": row_images.get(excel_row),
                    "excel_row": excel_row,
                }
            )
        return cases

    @transaction.atomic
    def _import_case(
        self,
        subgroup: Any,
        case: dict[str, Any],
        user: Any,
        archive: zipfile.ZipFile,
    ) -> Report:
        kind = KIND_BY_LABEL.get(case["kind"].strip().lower())
        if kind is None:
            raise CommandError(f"Ukendt kategori på sag #{case['number']}: {case['kind']!r}")
        status = STATUS_BY_LABEL.get(case["status"].strip().lower())
        if status is None:
            raise CommandError(f"Ukendt status på sag #{case['number']}: {case['status']!r}")

        created_at = _parse_date(case["date"])

        report = Report.objects.create(
            subgroup=subgroup,
            number=case["number"],
            kind=kind,
            status=status,
            description=case["description"],
            submitted_by=user,
            legacy_reporter_name="" if user else (case["name"] or ""),
            legacy_url=case.get("link") or "",
        )
        # created_at is auto_now_add, so it has to be written after the fact.
        # closed_at is deliberately left null even for Afsluttet cases: the export
        # records no closing date, and inventing one would be worse than blank.
        Report.objects.filter(pk=report.pk).update(created_at=created_at)
        report.refresh_from_db()

        note = "Importeret fra Driftsudvalgets tidligere indrapporteringssystem."
        if not user and case["name"]:
            note += f" Indrapporteret af {case['name']}."
        event = ReportEvent.objects.create(
            report=report,
            kind=ReportEvent.Kind.CREATED,
            author=user,
            message=note,
        )
        ReportEvent.objects.filter(pk=event.pk).update(created_at=created_at)

        if case.get("image_path"):
            self._attach_photo(report, archive, case["image_path"])
        return report

    def _attach_photo(self, report: Report, archive: zipfile.ZipFile, path: str) -> None:
        """Save an embedded image as a ReportPhoto and queue its thumbnail."""
        data = archive.read(path)
        filename = f"sag-{report.number}-{Path(path).name}"
        photo = ReportPhoto(report=report, name=filename)
        photo.image.save(filename, ContentFile(data), save=True)

        from apps.reports.tasks import generate_report_photo_thumbnail_task

        generate_report_photo_thumbnail_task(photo.id)
