"""Helpers for license plate normalization and display formatting."""

import re

_DANISH_PLATE_RE = re.compile(r"^[A-Z]{2}\d{5}$")


def normalize_license_plate(plate: str) -> str:
    """Canonical storage form: uppercase, no whitespace."""
    if not plate:
        return ""
    return "".join(plate.upper().split())


def format_license_plate(plate: str) -> str:
    """Display form for Danish plates (2 letters + 5 digits): 'AB 12 345'.
    Non-Danish or partial inputs are returned in normalized form unchanged."""
    norm = normalize_license_plate(plate)
    if _DANISH_PLATE_RE.fullmatch(norm):
        return f"{norm[0:2]} {norm[2:4]} {norm[4:7]}"
    return norm
