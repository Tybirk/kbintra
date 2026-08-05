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
# A point that opens in bold carries a label for the case it covers ("**Anmeldes
# skaden:** du betaler ..."). Section 5 is nine such cases, and losing the label
# turns the one section where a misreading costs money into a wall of prose.
_LEAD_PATTERN = re.compile(r"^\*\*(?P<lead>.+?)\*\*\s*(?P<rest>.*)$")


def _clean(text: str) -> str:
    """Drop leftover bold markers, which would otherwise render as literal stars."""
    return text.replace("**", "").strip()


class TermsBullet:
    """One point, optionally introduced by a bold label."""

    __slots__ = ("lead", "text")

    def __init__(self, text: str, lead: str = "") -> None:
        self.text = text
        self.lead = lead

    def filled(self, rate: str) -> "TermsBullet":
        # str.replace, not str.format: the file is edited by hand, and format()
        # would turn any stray brace into a crash at import.
        return TermsBullet(self.text.replace(_RATE_PLACEHOLDER, rate), self.lead)

    def as_dict(self) -> dict[str, str]:
        return {"lead": self.lead, "text": self.text}

    def as_line(self) -> str:
        return f"{self.lead} {self.text}".strip() if self.lead else self.text


class TermsSection:
    """A numbered section: a heading, then paragraphs and points in file order."""

    __slots__ = ("blocks", "heading", "open")

    def __init__(self, heading: str) -> None:
        self.heading = heading
        # (kind, payload) where kind is "paragraph" (str) or "bullets" (list).
        self.blocks: list[tuple[str, object]] = []
        # Whether the last block is still taking wrapped lines. A blank line
        # closes it, which is what separates two paragraphs of one section from
        # one paragraph split across two lines for readability.
        self.open = False

    def _tail(self, kind: str) -> object | None:
        if self.blocks and self.blocks[-1][0] == kind:
            return self.blocks[-1][1]
        return None

    def add_bullet(self, bullet: TermsBullet) -> None:
        existing = self._tail("bullets")
        if isinstance(existing, list):
            existing.append(bullet)
        else:
            self.blocks.append(("bullets", [bullet]))
        self.open = True

    def add_paragraph(self, text: str) -> None:
        self.blocks.append(("paragraph", text))
        self.open = True

    def close(self) -> None:
        self.open = False

    def continue_last(self, text: str) -> bool:
        """Append a wrapped line to whatever block is open. False if none is."""
        if not self.open:
            return False
        bullets = self._tail("bullets")
        if isinstance(bullets, list):
            bullets[-1].text = f"{bullets[-1].text} {text}".strip()
            return True
        paragraph = self._tail("paragraph")
        if isinstance(paragraph, str):
            self.blocks[-1] = ("paragraph", f"{paragraph} {text}")
            return True
        return False

    def filled(self, rate: str) -> "TermsSection":
        copy = TermsSection(self.heading)
        for kind, payload in self.blocks:
            if kind == "bullets" and isinstance(payload, list):
                copy.blocks.append(("bullets", [b.filled(rate) for b in payload]))
            elif isinstance(payload, str):
                copy.blocks.append(("paragraph", payload.replace(_RATE_PLACEHOLDER, rate)))
        return copy

    def as_dict(self) -> dict[str, object]:
        blocks: list[dict[str, object]] = []
        for kind, payload in self.blocks:
            if kind == "bullets" and isinstance(payload, list):
                blocks.append({"kind": "bullets", "items": [b.as_dict() for b in payload]})
            elif isinstance(payload, str):
                blocks.append({"kind": "paragraph", "text": payload})
        return {"heading": self.heading, "blocks": blocks}

    def as_lines(self) -> list[str]:
        lines = [self.heading, ""]
        for kind, payload in self.blocks:
            if kind == "bullets" and isinstance(payload, list):
                lines.extend(f"- {b.as_line()}" for b in payload)
            elif isinstance(payload, str):
                lines.append(payload)
            lines.append("")
        return lines


def _parse_terms(text: str) -> tuple[str, str, tuple[TermsSection, ...]]:
    """Pull the title, the date version and the sections out of vilkaar.md.

    Deliberately a hand-rolled reader rather than a Markdown library: the file
    uses one heading level, points and paragraphs, and nothing else. A Markdown
    dependency would buy tables and images the terms must not contain anyway.
    HTML comments carry the editing instructions and are skipped.
    """
    title = ""
    version = ""
    sections: list[TermsSection] = []
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
            # A blank line ends the current paragraph or list. Without this every
            # section collapses into one run-on paragraph.
            if sections:
                sections[-1].close()
            continue
        if line.startswith("## "):
            sections.append(TermsSection(line[3:].strip()))
            continue
        if line.startswith("# ") and not title:
            title = line[2:].strip()
            continue
        match = _VERSION_PATTERN.match(line)
        if match:
            version = match.group(1)
            continue
        # Anything before the first heading is preamble, not a term.
        if not sections:
            continue

        section = sections[-1]
        if line.startswith("- "):
            body = line[2:].strip()
            lead_match = _LEAD_PATTERN.match(body)
            if lead_match:
                section.add_bullet(
                    TermsBullet(
                        _clean(lead_match.group("rest")),
                        _clean(lead_match.group("lead")),
                    )
                )
            else:
                section.add_bullet(TermsBullet(_clean(body)))
        # A point or paragraph wrapped onto the next line, so the file can be
        # read at a sane width without every term becoming one long line.
        elif not section.continue_last(_clean(line)):
            section.add_paragraph(_clean(line))

    return title, version, tuple(sections)


def _load_terms() -> tuple[str, str, tuple[TermsSection, ...]]:
    """Read the terms at import, refusing to start on a broken file.

    Failing loudly is the point: a silently empty set of terms would mean
    borrowers agreeing to nothing, and the tests import this module, so a bad
    edit is caught in CI rather than discovered in production.
    """
    try:
        text = TERMS_FILE.read_text(encoding="utf-8")
    except OSError as exc:
        raise ImproperlyConfigured(f"Kunne ikke læse vilkårene i {TERMS_FILE}: {exc}") from exc

    title, version, sections = _parse_terms(text)
    if not title:
        raise ImproperlyConfigured(f"{TERMS_FILE} mangler en overskrift ('# ...').")
    if not version:
        raise ImproperlyConfigured(f"{TERMS_FILE} mangler en 'Version: ÅÅÅÅ-MM-DD'-linje.")
    if not sections:
        raise ImproperlyConfigured(f"{TERMS_FILE} indeholder ingen afsnit ('## ...').")
    if not any(section.blocks for section in sections):
        raise ImproperlyConfigured(f"{TERMS_FILE} indeholder ingen vilkår under afsnittene.")
    return title, version, sections


LOAN_TERMS_TITLE, TERMS_VERSION, LOAN_TERMS_SECTIONS = _load_terms()


def _format_rate(rate: Decimal | None) -> str:
    effective = DEFAULT_RATE_PER_KM if rate is None else rate
    return f"{effective:.2f}".replace(".", ",")


def loan_terms_sections(rate: Decimal | None = None) -> list[dict[str, object]]:
    """The terms as headed sections, with the applicable rate filled in."""
    formatted = _format_rate(rate)
    return [section.filled(formatted).as_dict() for section in LOAN_TERMS_SECTIONS]


def loan_terms_text(rate: Decimal | None = None) -> str:
    """The terms as one plain-text block, for email and for the record."""
    formatted = _format_rate(rate)
    lines: list[str] = [LOAN_TERMS_TITLE, ""]
    for section in LOAN_TERMS_SECTIONS:
        lines.extend(section.filled(formatted).as_lines())
    return "\n".join(lines).strip()
