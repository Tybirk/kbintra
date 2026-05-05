"""
Reinterpret start/end of legacy-imported events as Copenhagen local time.

The legacy import (apps.users.management.commands.import_legacy) parsed
WordPress event_start strings as UTC when they were actually Copenhagen
wall-clock time. Affected events are stored 1h (winter) or 2h (summer)
ahead of the intended moment.

This shifts each affected event's stored UTC value by treating its
wall-clock as Europe/Copenhagen and converting back to UTC. ZoneInfo
handles DST per-event automatically.

Run with --dry-run first to preview the shift.
"""

from datetime import date, datetime
from zoneinfo import ZoneInfo

from django.core.management.base import BaseCommand

from apps.events.models import Event

CPH = ZoneInfo("Europe/Copenhagen")
UTC = ZoneInfo("UTC")
IMPORT_DATE = date(2026, 4, 24)


def reinterpret_as_cph(dt: datetime) -> datetime:
    naive_wallclock = dt.replace(tzinfo=None)
    return naive_wallclock.replace(tzinfo=CPH).astimezone(UTC)


class Command(BaseCommand):
    help = "Shift legacy-imported event datetimes from mis-tagged UTC to true UTC (Copenhagen-local interpretation)."

    def add_arguments(self, parser: object) -> None:
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would change without writing to the database.",
        )

    def handle(self, *args: object, **options: object) -> None:
        dry_run = options["dry_run"]

        qs = Event.objects.filter(created_at__date=IMPORT_DATE).order_by("id")
        total = qs.count()
        self.stdout.write(f"Found {total} events imported on {IMPORT_DATE}.")

        changed = 0
        for event in qs.iterator():
            new_start = reinterpret_as_cph(event.start_datetime)
            new_end = reinterpret_as_cph(event.end_datetime)
            new_deadline = reinterpret_as_cph(event.rsvp_deadline) if event.rsvp_deadline else None

            self.stdout.write(
                f"  id={event.id:3d}  {event.title[:40]:40s}  "
                f"{event.start_datetime.isoformat()} -> {new_start.isoformat()}"
            )

            if not dry_run:
                event.start_datetime = new_start
                event.end_datetime = new_end
                if new_deadline is not None:
                    event.rsvp_deadline = new_deadline
                update_fields = ["start_datetime", "end_datetime"]
                if new_deadline is not None:
                    update_fields.append("rsvp_deadline")
                event.save(update_fields=update_fields)
            changed += 1

        prefix = "Would shift" if dry_run else "Shifted"
        self.stdout.write(self.style.SUCCESS(f"{prefix} {changed} events."))
