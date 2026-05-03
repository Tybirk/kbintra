"""
Management command to import bookings from ICS files exported from Teamup.

Usage:
    uv run python manage.py import_ics_bookings <ics_dir> [--user <email>] [--dry-run]

Each ICS file corresponds to one room (identified by CATEGORIES field).

Import rules:
  FREQ=WEEKLY, INTERVAL=1  →  RecurringBooking + RecurringBookingException per EXDATE
  Any other RRULE           →  one-time Event at DTSTART (logged as warning)
  No RRULE                  →  one-time Event

Conflicts are logged but never cause the command to abort.
"""

import os
import re
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from apps.bookings.models import RecurringBooking, RecurringBookingException, Room
from apps.events.models import Event

User = get_user_model()
CPH = ZoneInfo("Europe/Copenhagen")

ICS_DAYS = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}

# Events with these exact titles are silently skipped during import.
SKIP_TITLES: set[str] = {
    "Reserveret til fællesmad (Steffen, 21)",
}

# Exact title rewrites applied before importing. Add entries here to clean up
# ICS titles that carry unnecessary person/house-number suffixes.
TITLE_REWRITES: dict[str, str] = {
    "Fællesmad (Steffen, 21)": "Fællesmad",
    "Frit tilgængelig (Terkild, 29)": "Frit tilgængelig",
}

# Maps CATEGORIES values in the ICS (Teamup room names) to the canonical room
# names used in this app. Add entries here when importing from new exports.
ICS_ROOM_NAME_MAP: dict[str, str] = {
    "1. Spisesal": "Spisesal",
    "2. Køkken": "Køkken",
    "3. Café": "Café",
    "4. Væksthuse": "Store væksthus",
    "5. Multirum": "Multirum",
    "6. Værelse 1": "Værelse 1",
    "7. Værelse 2": "Værelse 2",
    "8. Delekontor": "Delekontor",
}


# ---------------------------------------------------------------------------
# ICS parsing helpers
# ---------------------------------------------------------------------------


def _unfold(text: str) -> str:
    """Remove ICS line folding (continuation lines start with SPACE or TAB)."""
    return re.sub(r"\r?\n[ \t]", "", text)


def _unescape(value: str) -> str:
    return value.replace("\\n", "\n").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")


def _parse_dt(value: str, params: dict) -> datetime | None:
    """Parse a DTSTART/DTEND/EXDATE value string into an aware datetime."""
    value_type = params.get("VALUE", "")
    tzid = params.get("TZID", "")

    if value_type == "DATE":
        d = datetime.strptime(value, "%Y%m%d")
        return d.replace(tzinfo=CPH)

    if value.endswith("Z"):
        return datetime.strptime(value[:-1], "%Y%m%dT%H%M%S").replace(tzinfo=UTC)

    if tzid:
        return datetime.strptime(value, "%Y%m%dT%H%M%S").replace(tzinfo=ZoneInfo(tzid))

    # Fallback: assume Copenhagen
    return datetime.strptime(value, "%Y%m%dT%H%M%S").replace(tzinfo=CPH)


def _parse_property(line: str) -> tuple[str, str, dict]:
    """Parse one unfolded ICS property line → (name, value, params)."""
    colon_idx = line.find(":")
    if colon_idx < 0:
        return "", "", {}
    prop_part = line[:colon_idx]
    value = line[colon_idx + 1 :]

    segments = prop_part.split(";")
    name = segments[0].upper()
    params: dict[str, str] = {}
    for seg in segments[1:]:
        if "=" in seg:
            k, v = seg.split("=", 1)
            params[k.upper()] = v
    return name, value, params


def parse_ics_events(filepath: str) -> list[dict]:
    """Return a list of VEVENT property dicts parsed from an ICS file."""
    with open(filepath, encoding="utf-8") as f:
        text = f.read()

    text = _unfold(text)
    events: list[dict] = []
    in_vevent = False
    current: dict = {}

    for line in text.splitlines():
        stripped = line.strip()
        if stripped == "BEGIN:VEVENT":
            in_vevent = True
            current = {}
            continue
        if stripped == "END:VEVENT":
            if in_vevent:
                in_vevent = False
                events.append(current)
            continue
        if not in_vevent:
            continue

        name, value, params = _parse_property(line)
        if not name:
            continue

        if name == "EXDATE":
            # EXDATE may appear multiple times in the same VEVENT
            current.setdefault("EXDATE_LIST", []).append((value, params))
        else:
            current[name] = (value, params)

    return events


def parse_exdates(exdate_list: list[tuple]) -> list[date]:
    """Flatten and parse all EXDATE entries into a list of date objects."""
    dates: list[date] = []
    for value, params in exdate_list:
        for part in value.split(","):
            part = part.strip()
            if not part:
                continue
            try:
                dt = _parse_dt(part, params)
                if dt:
                    dates.append(dt.astimezone(CPH).date())
            except Exception:
                pass
    return dates


def _resolve_user_from_ev(ev: dict, fallback: object) -> object:
    """Try to find the responsible user via the house number embedded in the event.

    Looks at X-TEAMUP-NAVN-PU00E5-ANSVARLIG-HUSNUMMER (the 'responsible person,
    house number' field Teamup exports). Extracts every integer from the string and
    tries each as a house slug. Returns the first active user found, or fallback.
    """
    raw = ev.get("X-TEAMUP-NAVN-PU00E5-ANSVARLIG-HUSNUMMER")
    if not raw:
        return fallback
    text = _unescape(raw[0])
    for number in re.findall(r"\d+", text):
        user = User.objects.filter(house__slug=number, is_active=True).first()
        if user:
            return user
    return fallback


def parse_rrule(rrule_value: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for part in rrule_value.split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            result[k] = v
    return result


# ---------------------------------------------------------------------------
# Management command
# ---------------------------------------------------------------------------


class Command(BaseCommand):
    help = "Import bookings from ICS files (Teamup export) into the booking system"

    def add_arguments(self, parser: object) -> None:
        parser.add_argument("ics_dir", help="Directory containing .ics files")
        parser.add_argument(
            "--user",
            help="Email of user to assign as creator (default: first superuser)",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be imported without making changes",
        )

    def handle(self, *args: object, **options: object) -> None:
        ics_dir = str(options["ics_dir"])
        dry_run = bool(options["dry_run"])

        if not os.path.isdir(ics_dir):
            raise CommandError(f"Directory not found: {ics_dir}")

        user = self._get_user(options.get("user"))
        self.stdout.write(f"Creator: {user.email}")
        if dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN — no changes will be saved\n"))

        stats: dict[str, int] = {
            "rooms_created": 0,
            "recurring_created": 0,
            "recurring_skipped": 0,
            "exceptions_created": 0,
            "events_created": 0,
            "events_skipped": 0,
            "unsupported_rrule": 0,
        }

        for filename in sorted(f for f in os.listdir(ics_dir) if f.endswith(".ics")):
            self.stdout.write(f"\n--- {filename} ---")
            self._process_file(os.path.join(ics_dir, filename), user, dry_run, stats)

        self.stdout.write("\n" + "=" * 50)
        self.stdout.write(
            self.style.SUCCESS(
                f"Done:\n"
                f"  Rooms created:       {stats['rooms_created']}\n"
                f"  Recurring created:   {stats['recurring_created']}\n"
                f"  Recurring skipped:   {stats['recurring_skipped']} (conflict)\n"
                f"  Exceptions created:  {stats['exceptions_created']}\n"
                f"  Events created:      {stats['events_created']}\n"
                f"  Events skipped:      {stats['events_skipped']} (conflict)\n"
                f"  Unsupported RRULE:   {stats['unsupported_rrule']} (imported as one-time)"
            )
        )

    def _get_user(self, email: str | None) -> object:
        if email:
            try:
                return User.objects.get(email=email)
            except User.DoesNotExist as exc:
                raise CommandError(f"User with email {email!r} not found") from exc
        user = User.objects.filter(is_superuser=True).first()
        if not user:
            user = User.objects.filter(is_staff=True).first()
        if not user:
            raise CommandError("No staff user found. Use --user <email> to specify a creator.")
        return user

    def _process_file(
        self, filepath: str, user: object, dry_run: bool, stats: dict[str, int]
    ) -> None:
        vevents = parse_ics_events(filepath)

        room_name: str | None = None
        for ev in vevents:
            if "CATEGORIES" in ev:
                room_name = _unescape(ev["CATEGORIES"][0]).strip()
                break

        if not room_name:
            self.stdout.write(self.style.WARNING("  No CATEGORIES found, skipping"))
            return

        canonical_name = ICS_ROOM_NAME_MAP.get(room_name, room_name)
        room = self._get_or_create_room(room_name, canonical_name, dry_run, stats)
        self.stdout.write(
            f"  Room: {canonical_name}"
            + (f" (mapped from {room_name!r})" if canonical_name != room_name else "")
        )

        for ev in vevents:
            self._process_event(ev, room, user, dry_run, stats)

    def _get_or_create_room(
        self, ics_name: str, canonical_name: str, dry_run: bool, stats: dict[str, int]
    ) -> Room:
        try:
            return Room.objects.get(name=canonical_name)
        except Room.DoesNotExist:
            self.stdout.write(
                f"  Creating room: {canonical_name!r} (no existing room matched {ics_name!r})"
            )
            if not dry_run:
                room = Room.objects.create(name=canonical_name)
            else:
                room = Room(name=canonical_name)
            stats["rooms_created"] += 1
            return room

    def _process_event(
        self,
        ev: dict,
        room: Room,
        user: object,
        dry_run: bool,
        stats: dict[str, int],
    ) -> None:
        if "SUMMARY" not in ev or "DTSTART" not in ev or "DTEND" not in ev:
            return

        title = _unescape(ev["SUMMARY"][0])
        if title in SKIP_TITLES:
            return
        title = TITLE_REWRITES.get(title, title)
        description = _unescape(ev.get("DESCRIPTION", ("", {}))[0]).strip()

        try:
            dtstart = _parse_dt(ev["DTSTART"][0], ev["DTSTART"][1])
            dtend = _parse_dt(ev["DTEND"][0], ev["DTEND"][1])
        except Exception as exc:
            self.stdout.write(f"  WARN: Cannot parse datetime for {title!r}: {exc}")
            return

        if dtstart is None or dtend is None:
            self.stdout.write(f"  WARN: Missing datetime for {title!r}, skipping")
            return

        resolved_user = _resolve_user_from_ev(ev, fallback=user)

        rrule_entry = ev.get("RRULE")
        if rrule_entry:
            rrule = parse_rrule(rrule_entry[0])
            freq = rrule.get("FREQ", "")
            interval = int(rrule.get("INTERVAL", "1"))

            if freq == "WEEKLY" and interval == 1:
                self._import_recurring(
                    ev,
                    room,
                    resolved_user,
                    title,
                    description,
                    dtstart,
                    dtend,
                    rrule,
                    dry_run,
                    stats,
                )
            else:
                stats["unsupported_rrule"] += 1
                self.stdout.write(
                    f"  WARN: Unsupported RRULE '{rrule_entry[0]}' for {title!r}"
                    f" — importing as one-time event on {dtstart.astimezone(CPH).date()}"
                )
                self._import_event(
                    room, resolved_user, title, description, dtstart, dtend, dry_run, stats
                )
        else:
            self._import_event(
                room, resolved_user, title, description, dtstart, dtend, dry_run, stats
            )

    def _import_recurring(
        self,
        ev: dict,
        room: Room,
        user: object,
        title: str,
        description: str,
        dtstart: datetime,
        dtend: datetime,
        rrule: dict[str, str],
        dry_run: bool,
        stats: dict[str, int],
    ) -> None:
        byday = rrule.get("BYDAY", "")
        if byday:
            days = [
                ICS_DAYS[d.strip().upper()[-2:]]
                for d in byday.split(",")
                if d.strip()[-2:].upper() in ICS_DAYS
            ]
        else:
            days = [dtstart.astimezone(CPH).weekday()]

        days_sorted = sorted(set(days))
        start_time = dtstart.astimezone(CPH).time()
        end_time = dtend.astimezone(CPH).time()
        effective_from = dtstart.astimezone(CPH).date()

        until_str = rrule.get("UNTIL")
        effective_until: date | None = None
        if until_str:
            try:
                until_dt = _parse_dt(until_str, {})
                if until_dt:
                    effective_until = until_dt.astimezone(CPH).date()
            except Exception:
                pass

        # Conflict check: same room + title + start_time (skip if room has no PK yet)
        existing = (
            RecurringBooking.objects.filter(room=room, title=title, start_time=start_time).first()
            if room.pk
            else None
        )
        if existing:
            self.stdout.write(f"  SKIP (recurring): {title!r} — already exists (id={existing.pk})")
            stats["recurring_skipped"] += 1
            return

        day_names = ", ".join(RecurringBooking.DayOfWeek(d).label for d in days_sorted)
        self.stdout.write(
            f"  Recurring: {title!r} | {day_names} | {start_time:%H:%M}–{end_time:%H:%M}"
            f" | from {effective_from}"
        )

        if not dry_run:
            rb = RecurringBooking.objects.create(
                room=room,
                created_by=user,
                title=title,
                description=description,
                days_of_week=days_sorted,
                start_time=start_time,
                end_time=end_time,
                effective_from=effective_from,
                effective_until=effective_until,
            )
            stats["recurring_created"] += 1

            exdate_list = ev.get("EXDATE_LIST", [])
            if exdate_list:
                for exc_date in parse_exdates(exdate_list):
                    try:
                        _, created = RecurringBookingException.objects.get_or_create(
                            recurring_booking=rb,
                            exception_date=exc_date,
                        )
                        if created:
                            stats["exceptions_created"] += 1
                    except Exception as exc:
                        self.stdout.write(f"  WARN: Exception on {exc_date}: {exc}")
        else:
            stats["recurring_created"] += 1
            stats["exceptions_created"] += len(parse_exdates(ev.get("EXDATE_LIST", [])))

    def _import_event(
        self,
        room: Room,
        user: object,
        title: str,
        description: str,
        dtstart: datetime,
        dtend: datetime,
        dry_run: bool,
        stats: dict[str, int],
    ) -> None:
        # Conflict check: same title + exact start_datetime + this room
        if room.pk and not dry_run:
            existing = Event.objects.filter(
                title=title,
                start_datetime=dtstart,
                rooms=room,
            ).first()
            if existing:
                self.stdout.write(
                    f"  SKIP (event): {title!r} on {dtstart.astimezone(CPH):%Y-%m-%d %H:%M}"
                    f" — already exists (id={existing.pk})"
                )
                stats["events_skipped"] += 1
                return

        self.stdout.write(
            f"  Event: {title!r} | {dtstart.astimezone(CPH):%Y-%m-%d %H:%M}"
            f"–{dtend.astimezone(CPH):%H:%M}"
        )

        if not dry_run:
            try:
                event = Event.objects.create(
                    title=title,
                    description=description,
                    created_by=user,
                    visibility=Event.Visibility.PRIVATE,
                    start_datetime=dtstart,
                    end_datetime=dtend,
                )
                event.rooms.add(room)
                stats["events_created"] += 1
            except Exception as exc:
                self.stdout.write(self.style.ERROR(f"  ERROR: {title!r}: {exc}"))
        else:
            stats["events_created"] += 1
