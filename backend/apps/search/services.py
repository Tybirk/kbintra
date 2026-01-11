"""
Fuzzy search services using rapidfuzz.
"""

import re
from html import unescape
from typing import Any

from rapidfuzz import fuzz


def strip_html(html_content: str) -> str:
    """Strip HTML tags and decode entities."""
    if not html_content:
        return ""
    clean = re.sub(r"<[^>]+>", " ", html_content)
    clean = unescape(clean)
    # Normalize whitespace
    clean = re.sub(r"\s+", " ", clean).strip()
    return clean


def fuzzy_match(query: str, text: str, threshold: int = 60) -> tuple[bool, int]:
    """
    Check if query fuzzy matches text.
    Returns (matches, score) tuple.
    Uses token_set_ratio for partial matching which handles:
    - Word order differences
    - Partial matches
    - Typos and misspellings
    """
    if not text or not query:
        return False, 0

    # Use token_set_ratio for best fuzzy matching
    score = fuzz.token_set_ratio(query.lower(), text.lower())
    return score >= threshold, score


def search_queryset(
    queryset,
    fields: list[str],
    query: str,
    limit: int = 10,
    threshold: int = 60,
) -> list[tuple[Any, int]]:
    """
    Generic fuzzy search over a queryset's fields.
    Returns list of (object, best_score) sorted by score descending.

    Args:
        queryset: Django queryset to search
        fields: List of field names to search
        query: Search query string
        limit: Maximum results to return
        threshold: Minimum fuzzy match score (0-100)
    """
    results = []

    for obj in queryset:
        best_score = 0
        for field in fields:
            value = getattr(obj, field, "")
            if callable(value):
                value = value()
            value = str(value) if value else ""

            # Strip HTML for content fields
            if field in ("content", "description"):
                value = strip_html(value)

            matches, score = fuzzy_match(query, value, threshold)
            if matches and score > best_score:
                best_score = score

        if best_score > 0:
            results.append((obj, best_score))

    # Sort by score descending and limit
    results.sort(key=lambda x: x[1], reverse=True)
    return results[:limit]


def create_excerpt(text: str, max_length: int = 100) -> str:
    """Create a short excerpt from text."""
    if not text:
        return ""
    text = strip_html(text)
    if len(text) <= max_length:
        return text
    return text[: max_length - 3].rsplit(" ", 1)[0] + "..."
