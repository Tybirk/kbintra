"""
FTS5 full-text search services.
"""

import json
import re
from datetime import datetime
from html import unescape

from django.db import connection, transaction


def _isoformat(dt: datetime | None) -> str:
    """Convert a datetime to ISO string, or empty string if None."""
    return dt.isoformat() if dt else ""


def strip_html(html_content: str) -> str:
    """Strip HTML tags and decode entities."""
    if not html_content:
        return ""
    clean = re.sub(r"<[^>]+>", " ", html_content)
    clean = unescape(clean)
    # Normalize whitespace
    clean = re.sub(r"\s+", " ", clean).strip()
    return clean


def create_excerpt(text: str, max_length: int = 100) -> str:
    """Create a short excerpt from text."""
    if not text:
        return ""
    text = strip_html(text)
    if len(text) <= max_length:
        return text
    return text[: max_length - 3].rsplit(" ", 1)[0] + "..."


def build_fts_query(query: str) -> str:
    """
    Build an FTS5 query string with prefix matching for typeahead.
    Sanitizes input and adds * suffix to each token.
    Example: "community mee" -> '"community"* "mee"*'
    """
    # Remove FTS5 special characters
    sanitized = re.sub(r'["\'\(\)\*\+\-\:\;\^\~\{\}\[\]\\]', " ", query)
    tokens = sanitized.split()
    if not tokens:
        return ""
    # Each token gets quoted and suffixed with * for prefix matching
    parts = [f'"{token}"*' for token in tokens]
    return " ".join(parts)


def index_object(
    obj_type: str,
    object_id: int,
    title: str,
    body: str,
    url: str,
    subtitle: str = "",
    extra: str = "",
    created_at: str = "",
) -> None:
    """Index (or re-index) an object in the FTS5 search_index table."""
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute(
            "DELETE FROM search_index WHERE type = %s AND object_id = %s",
            [obj_type, str(object_id)],
        )
        cursor.execute(
            "INSERT INTO search_index "
            "(title, body, type, object_id, url, subtitle, extra, created_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            [title, body, obj_type, str(object_id), url, subtitle, extra, created_at],
        )


def remove_object(obj_type: str, object_id: int) -> None:
    """Remove an object from the FTS5 search_index table."""
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute(
            "DELETE FROM search_index WHERE type = %s AND object_id = %s",
            [obj_type, str(object_id)],
        )


def fts_search(query: str, limit: int = 10) -> list[dict]:
    """
    Execute an FTS5 MATCH query and return results.
    Returns list of dicts with type, object_id, title, subtitle, url, extra.
    Ranking blends BM25 (title 10x body) with a recency boost.
    """
    fts_query = build_fts_query(query)
    if not fts_query:
        return []

    # Content types where a dynamic snippet from body is more useful than the
    # stored subtitle (e.g. post content, announcement text).
    _snippet_types = {"post", "announcement", "event", "thread"}

    with connection.cursor() as cursor:
        # bm25() returns negative values (more negative = better match).
        # Adding a positive age-penalty pushes older docs toward 0 (worse).
        # Content types (posts, threads, etc.): 0.01/day ≈ 3.65/year — strong decay.
        # Static types (users, houses, subgroups): 0.001/day — mild tiebreaker.
        # snippet() extracts a ~15-token window around the match from the body column.
        cursor.execute(
            "SELECT type, object_id, title, subtitle, url, extra, "
            "  snippet(search_index, 1, '', '', '…', 15) "
            "FROM search_index WHERE search_index MATCH %s "
            "ORDER BY bm25(search_index, 10.0, 1.0) "
            "  + CASE WHEN created_at = '' THEN 0 "
            "    WHEN type IN ('thread','post','announcement','event','file') "
            "    THEN 0.01 * (julianday('now') - julianday(created_at)) "
            "    ELSE 0.001 * (julianday('now') - julianday(created_at)) "
            "    END "
            "LIMIT %s",
            [fts_query, limit],
        )
        columns = ["type", "object_id", "title", "subtitle", "url", "extra", "snippet"]
        results = []
        for row in cursor.fetchall():
            item = dict(zip(columns, row, strict=False))
            item["object_id"] = int(item["object_id"])
            # For content types, prefer the dynamic snippet over the stored subtitle
            snippet = item.pop("snippet", "")
            if snippet and item["type"] in _snippet_types:
                item["subtitle"] = snippet
            # Parse extra JSON if present
            if item["extra"]:
                try:
                    item["extra"] = json.loads(item["extra"])
                except (json.JSONDecodeError, TypeError):
                    item["extra"] = None
            else:
                item["extra"] = None
            results.append(item)
        return results
