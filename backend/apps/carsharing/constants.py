"""
Constants for the car sharing (bildeling) app.

The rate lives in exactly one place so an annual adjustment is a one-line change
rather than an edit to every car. A car's own rate_per_km is only an override.

The loan terms are not in here: they live in vilkaar.md next to this file, so the
community can edit its own agreement without touching Python. See TERMS_FILE.
"""

import re
from decimal import Decimal
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

# DKK per driven kilometre, used when a car has no rate of its own.
DEFAULT_RATE_PER_KM = Decimal("3.94")

# Upper bound on how many owners one request may reach. Without it, "pick
# several cars" is just a broadcast with extra steps. Counts cars rather than
# households, so two cars in one house use two slots.
MAX_CANDIDATES_PER_LOAN = 10

# Guards the availability day-walk and keeps loans reviewable.
MAX_LOAN_DAYS = 30

# A painted week can at worst need one window per day per gap; well above that.
MAX_BLOCKS_PER_CAR = 60

# The terms themselves. Inside the app package rather than in docs/ because the
# server has to read it at runtime and the backend image is built from ./backend
# only; docs/bildeling-vilkaar.md is a symlink to this file so there is one text.
TERMS_FILE = Path(__file__).resolve().parent / "vilkaar.md"

# A date, so "which terms did they accept" is answerable by looking at a calendar.
_VERSION_PATTERN = re.compile(r"^Version:\s*(\d{4}-\d{2}-\d{2})\s*$")
_RATE_PLACEHOLDER = "{rate}"


def _parse_terms(text: str) -> tuple[str, str, tuple[str, ...]]:
    """Pull the title, the date version and the bullets out of vilkaar.md.

    Deliberately a hand-rolled reader rather than a Markdown library: the file is
    a flat title-version-bullets document, the app renders the points as a plain
    list, and adding a parser dependency for that would be the tail wagging the
    dog. HTML comments carry the editing instructions and are skipped.
    """
    title = ""
    version = ""
    bullets: list[str] = []
    in_comment = False

    for raw in text.splitlines():
        line = raw.strip()

        if in_comment:
            in_comment = "-->" not in line
            continue
        if line.startswith("<!--"):
            in_comment = "-->" not in line
            continue

        if not line:
            continue
        if line.startswith("# ") and not title:
            title = line[2:].strip()
            continue
        match = _VERSION_PATTERN.match(line)
        if match:
            version = match.group(1)
            continue
        if line.startswith("- "):
            bullets.append(line[2:].strip())
        elif bullets:
            # A bullet wrapped onto the next line, so the file can be read at a
            # sane width without every point becoming one long line.
            bullets[-1] = f"{bullets[-1]} {line}"

    return title, version, tuple(bullets)


def _load_terms() -> tuple[str, str, tuple[str, ...]]:
    """Read the terms at import, refusing to start on a broken file.

    Failing loudly is the point: a silently empty set of terms would mean
    borrowers agreeing to nothing, and the tests import this module, so a bad
    edit is caught in CI rather than discovered in production.
    """
    try:
        text = TERMS_FILE.read_text(encoding="utf-8")
    except OSError as exc:
        raise ImproperlyConfigured(f"Kunne ikke læse vilkårene i {TERMS_FILE}: {exc}") from exc

    title, version, bullets = _parse_terms(text)
    if not title:
        raise ImproperlyConfigured(f"{TERMS_FILE} mangler en overskrift ('# ...').")
    if not version:
        raise ImproperlyConfigured(f"{TERMS_FILE} mangler en 'Version: ÅÅÅÅ-MM-DD'-linje.")
    if not bullets:
        raise ImproperlyConfigured(f"{TERMS_FILE} indeholder ingen vilkår ('- ...').")
    return title, version, bullets


LOAN_TERMS_TITLE, TERMS_VERSION, LOAN_TERMS_BULLETS = _load_terms()


def _format_rate(rate: Decimal | None) -> str:
    effective = DEFAULT_RATE_PER_KM if rate is None else rate
    return f"{effective:.2f}".replace(".", ",")


def loan_terms_bullets(rate: Decimal | None = None) -> list[str]:
    """The terms as separate points, with the applicable rate filled in."""
    formatted = _format_rate(rate)
    # str.replace, not str.format: the file is edited by hand, and format() would
    # turn any stray brace into a crash at import.
    return [bullet.replace(_RATE_PLACEHOLDER, formatted) for bullet in LOAN_TERMS_BULLETS]


def loan_terms_text(rate: Decimal | None = None) -> str:
    """The terms as one plain-text block, for email and for the record."""
    lines = "\n".join(f"- {bullet}" for bullet in loan_terms_bullets(rate))
    return f"{LOAN_TERMS_TITLE}\n\n{lines}"
