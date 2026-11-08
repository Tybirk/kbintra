"""A resident's maddage as one iCalendar file (RFC 5545).

Written by hand like the event download in ``apps/events/views.py``: a handful
of events does not need a dependency.
"""

from collections.abc import Iterable
from datetime import UTC, date, datetime, time

from django.conf import settings
from django.utils import timezone

from apps.food.constants import FOOD_TEAM_CALENDAR_END, FOOD_TEAM_CALENDAR_START
from apps.food.models import FoodTeam
from apps.users.models import User

MAX_LINE_OCTETS = 75


def _escape(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace(",", "\\,")
        .replace(";", "\\;")
        .replace("\r", "")
        .replace("\n", "\\n")
    )


def _fold(line: str) -> str:
    """Break a line at 75 octets; a continuation line starts with one space.

    Counted in octets, not characters, and never inside a character: a Danish
    letter is two octets, and a name split through one comes out garbled.
    """
    lines: list[str] = []
    current = ""
    octets = 0
    for char in line:
        width = len(char.encode())
        if octets + width > MAX_LINE_OCTETS:
            lines.append(current)
            current = " "
            octets = 1
        current += char
        octets += width
    lines.append(current)
    return "\r\n".join(lines)


def _utc(day: date, at: time) -> str:
    """A Danish wall-clock time in UTC, so summer time is settled here and not by each client."""
    local = timezone.make_aware(datetime.combine(day, at), timezone.get_default_timezone())
    return local.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


def _team_event(team: FoodTeam, user: User, stamp: str) -> list[str]:
    others = [
        f"{member.user.first_name} {member.user.last_name}".strip()
        for member in team.members.all()
        if member.user_id != user.pk
    ]
    # With the user in the UID, a shared calendar can hold both halves of a
    # couple on the same day, and importing again replaces rather than doubles.
    event = [
        "BEGIN:VEVENT",
        f"UID:madhold-{team.pk}-{user.pk}@kbintra",
        f"DTSTAMP:{stamp}",
        f"DTSTART:{_utc(team.date, FOOD_TEAM_CALENDAR_START)}",
        f"DTEND:{_utc(team.date, FOOD_TEAM_CALENDAR_END)}",
        "SUMMARY:Madhold",
        f"URL:{settings.SITE_URL}/madhold/mine-hold",
    ]
    if others:
        event.append(f"DESCRIPTION:{_escape('Sammen med: ' + ', '.join(sorted(others)))}")
    event.append("END:VEVENT")
    return event


def my_teams_calendar(teams: Iterable[FoodTeam], user: User) -> str:
    """One calendar holding an event for each of the given teams."""
    stamp = timezone.now().astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//KB Intra//Madhold//DA",
        "CALSCALE:GREGORIAN",
    ]
    for team in teams:
        lines += _team_event(team, user, stamp)
    lines.append("END:VCALENDAR")
    return "".join(f"{_fold(line)}\r\n" for line in lines)
