"""
FTS5 full-text search services.
"""

import json
import re
from datetime import datetime
from html import unescape

from django.db import connection, transaction

# æ/ø/å are independent Unicode letters, not diacritics, so FTS5's
# `unicode61 remove_diacritics 2` tokenizer does NOT fold them. We fold them
# manually at both index and query time so users can search with either form.
_DANISH_FOLD = str.maketrans(
    {
        "æ": "ae",
        "ø": "oe",
        "å": "aa",
        "Æ": "AE",
        "Ø": "OE",
        "Å": "AA",
    }
)


def fold_danish(text: str) -> str:
    """Replace æ/ø/å (and uppercase) with ae/oe/aa so search matches both forms."""
    if not text:
        return ""
    return text.translate(_DANISH_FOLD)


# Punctuation that should be treated as whitespace when comparing names.
# Hyphens, slashes, dots, etc. — so "grønt-udvalg" tokenises the same as
# "grønt udvalg" before fuzzy comparison.
_PUNCT_RE = re.compile(r"[-_/.,;:!?'\"`()\[\]{}]+")


def normalize_for_match(text: str) -> str:
    """Lowercase, fold Danish, replace punctuation with spaces, collapse whitespace.
    Used for fuzzy name matching against subgroups, users, etc."""
    if not text:
        return ""
    folded = fold_danish(text.lower())
    return " ".join(_PUNCT_RE.sub(" ", folded).split())


def levenshtein(a: str, b: str) -> int:
    """Standard iterative Levenshtein distance. Inputs are short (≤30 chars)
    so the O(len_a * len_b) DP is fine."""
    if len(a) < len(b):
        a, b = b, a
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a):
        curr = [i + 1]
        for j, cb in enumerate(b):
            cost = 0 if ca == cb else 1
            curr.append(min(prev[j + 1] + 1, curr[-1] + 1, prev[j] + cost))
        prev = curr
    return prev[-1]


def _max_dist_for_token(token: str) -> int:
    """Length-scaled edit-distance threshold per token.

    < 4 chars: exact only (too many false positives at small lengths).
    4-6 chars: 1 edit (e.g. 'terk' ~ 'terkild' prefix already covered by FTS;
               we mainly care about typos like 'husgrupen' ~ 'husgruppen').
    7+ chars: 2 edits.
    """
    n = len(token)
    if n < 4:
        return 0
    if n < 7:
        return 1
    return 2


def substring_name_matches(query: str, name_pairs: list[tuple[int, str]]) -> list[int]:
    """Return ids whose normalised name contains the normalised query as a
    substring. Used by advanced fuzzy mode so a partial like "udva" matches
    "Børne- og ungeudvalget" — neither FTS5 prefix matching nor token-level
    Levenshtein catches infixes."""
    q = normalize_for_match(query)
    if not q or len(q) < 2:
        return []
    return [obj_id for obj_id, name in name_pairs if q in normalize_for_match(name)]


def fuzzy_name_matches(query: str, name_pairs: list[tuple[int, str]]) -> list[int]:
    """Return ids whose name fuzzy-matches the query.

    Each query token must be within a length-scaled Levenshtein distance of
    some token in the candidate name. Both sides are normalised (Danish-fold,
    lowercase, punctuation → space) first, so 'grønt-udvalg' matches a
    subgroup named 'Grønt udvalg'.
    """
    q_tokens = normalize_for_match(query).split()
    if not q_tokens or not any(len(t) >= 4 for t in q_tokens):
        # Need at least one token long enough to safely tolerate edits.
        return []
    thresholds = [_max_dist_for_token(t) for t in q_tokens]
    matches: list[int] = []
    for obj_id, name in name_pairs:
        n_tokens = normalize_for_match(name).split()
        if not n_tokens:
            continue
        if all(
            any(levenshtein(qt, nt) <= thr for nt in n_tokens)
            for qt, thr in zip(q_tokens, thresholds, strict=False)
        ):
            matches.append(obj_id)
    return matches


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


def build_fts_query(query: str, prefix: bool = True) -> str:
    """
    Build an FTS5 query string.

    With ``prefix=True`` (default) each token gets a ``*`` suffix for
    typeahead matching: ``"community mee" -> '"community"* "mee"*'``.

    With ``prefix=False`` tokens are quoted but not suffixed, so only exact
    word matches are returned. Useful for the advanced-search "exact" mode.
    """
    # Fold Danish letters so a query with æøå matches docs stored with ae/oe/aa.
    folded = fold_danish(query)
    # Remove FTS5 special characters
    sanitized = re.sub(r'["\'\(\)\*\+\-\:\;\^\~\{\}\[\]\\]', " ", folded)
    tokens = sanitized.split()
    if not tokens:
        return ""
    suffix = "*" if prefix else ""
    parts = [f'"{token}"{suffix}' for token in tokens]
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
    """Index (or re-index) an object in the FTS5 search_index table.

    Title and body are stored Danish-folded (æ→ae, ø→oe, å→aa) so MATCH queries
    work regardless of which spelling the user types. Subtitle is left unfolded
    so the displayed text keeps its original Danish spelling.
    """
    folded_title = fold_danish(title)
    folded_body = fold_danish(body)
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute(
            "DELETE FROM search_index WHERE type = %s AND object_id = %s",
            [obj_type, str(object_id)],
        )
        cursor.execute(
            "INSERT INTO search_index "
            "(title, body, type, object_id, url, subtitle, extra, created_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            [
                folded_title,
                folded_body,
                obj_type,
                str(object_id),
                url,
                subtitle,
                extra,
                created_at,
            ],
        )


def remove_object(obj_type: str, object_id: int) -> None:
    """Remove an object from the FTS5 search_index table."""
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute(
            "DELETE FROM search_index WHERE type = %s AND object_id = %s",
            [obj_type, str(object_id)],
        )


# Content types where a dynamic snippet from body is more useful than the
# stored subtitle (e.g. post content, announcement text).
_SNIPPET_TYPES = {"post", "announcement", "event", "thread"}


def _parse_fts_row(row: tuple) -> dict:
    columns = ["type", "object_id", "title", "subtitle", "url", "extra", "created_at", "snippet"]
    item = dict(zip(columns, row, strict=False))
    item["object_id"] = int(item["object_id"])
    snippet = item.pop("snippet", "")
    if snippet and item["type"] in _SNIPPET_TYPES:
        item["subtitle"] = snippet
    if item["extra"]:
        try:
            item["extra"] = json.loads(item["extra"])
        except (json.JSONDecodeError, TypeError):
            item["extra"] = None
        else:
            item["extra"] = _sign_indexed_media(item["extra"])
    else:
        item["extra"] = None
    return item


def _sign_indexed_media(extra: object) -> object:
    """Attach a fresh media signature to a file URL coming out of the index.

    URLs are indexed unsigned on purpose — a signature lasts ~2 hours while an
    index entry lives until the row changes — so they have to be signed on the
    way out. Without this, a file opened from search still 401s on a client that
    has lost its session cookie, which is the case signed URLs exist for.
    """
    from apps.backup.signing import signed_media_url

    if isinstance(extra, dict) and extra.get("file_url"):
        return {**extra, "file_url": signed_media_url(extra["file_url"])}
    return extra


def fts_search(query: str, limit: int = 10) -> list[dict]:
    """
    Execute an FTS5 MATCH query and return a single flat ranked list.
    Used by tests / callers that don't need per-type bucketing.
    Ranking blends BM25 (title 10x body) with a recency boost.
    """
    fts_query = build_fts_query(query)
    if not fts_query:
        return []

    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT type, object_id, title, subtitle, url, extra, created_at, "
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
        return [_parse_fts_row(row) for row in cursor.fetchall()]


def fts_search_advanced(
    query: str,
    types: list[str] | None = None,
    prefix: bool = True,
    sort: str = "relevance",
    per_type_limit: int = 20,
) -> list[dict]:
    """
    Advanced FTS5 search: optional type filter, prefix toggle, and sort order.

    - ``types``: restrict to these FTS types (singular keys). ``None`` = all.
    - ``prefix``: when False, only exact word matches.
    - ``sort``: ``relevance`` (BM25 + recency penalty) or ``newest`` (created_at desc).
    - ``per_type_limit``: how many results per type bucket.

    Returns rows shaped like :func:`fts_search`. Bucketing is preserved so a
    single dominant type cannot crowd others out.
    """
    fts_query = build_fts_query(query, prefix=prefix)
    if not fts_query:
        return []

    # Score is computed inside the inner SELECT because bm25()/snippet() are
    # FTS5 auxiliary functions that only work in a direct query against the
    # virtual table — they can't be invoked from a CTE's OVER() clause.
    if sort == "newest":
        # Stable ordering: rows with a timestamp first, then newest first.
        score_expr = "CASE WHEN created_at = '' THEN 9999999999   ELSE -julianday(created_at) END"
    else:
        score_expr = (
            "bm25(search_index, 10.0, 1.0) "
            "+ CASE WHEN created_at = '' THEN 0 "
            "  WHEN type IN ('thread','post','announcement','event','file') "
            "  THEN 0.01 * (julianday('now') - julianday(created_at)) "
            "  ELSE 0.001 * (julianday('now') - julianday(created_at)) "
            "  END"
        )

    type_filter_sql = ""
    params: list = [fts_query]
    if types:
        placeholders = ",".join(["%s"] * len(types))
        type_filter_sql = f" AND type IN ({placeholders})"
        params.extend(types)
    params.append(per_type_limit)

    with connection.cursor() as cursor:
        cursor.execute(
            "WITH ranked AS ("
            "  SELECT type, object_id, title, subtitle, url, extra, created_at, "
            "    snippet(search_index, 1, '', '', '…', 15) AS snip, "
            "    " + score_expr + " AS score "
            "  FROM search_index WHERE search_index MATCH %s" + type_filter_sql + " "
            "), "
            "numbered AS ("
            "  SELECT *, ROW_NUMBER() OVER (PARTITION BY type ORDER BY score) AS rn "
            "  FROM ranked"
            ") "
            "SELECT type, object_id, title, subtitle, url, extra, created_at, snip "
            "FROM numbered WHERE rn <= %s ORDER BY type, rn",
            params,
        )
        return [_parse_fts_row(row) for row in cursor.fetchall()]


def fts_search_per_type(query: str, per_type_limit: int = 10) -> list[dict]:
    """
    Execute an FTS5 MATCH query and return up to ``per_type_limit`` results
    per type, ordered within each type by BM25 + recency penalty.

    This avoids the "single dominant type crowds out others" problem with a
    global top-K — e.g. searching "Dagsorden" matches many file titles whose
    BM25 scores would otherwise consume every slot. The whole thing is one
    SQL statement using a window function partitioned by type, so it's
    roughly as fast as the old global query (vs ~3-5x slower if we looped
    in Python).
    """
    fts_query = build_fts_query(query)
    if not fts_query:
        return []

    with connection.cursor() as cursor:
        cursor.execute(
            "WITH ranked AS ("
            "  SELECT type, object_id, title, subtitle, url, extra, created_at, "
            "    snippet(search_index, 1, '', '', '…', 15) AS snip, "
            "    bm25(search_index, 10.0, 1.0) "
            "      + CASE WHEN created_at = '' THEN 0 "
            "        WHEN type IN ('thread','post','announcement','event','file') "
            "        THEN 0.01 * (julianday('now') - julianday(created_at)) "
            "        ELSE 0.001 * (julianday('now') - julianday(created_at)) "
            "        END AS score "
            "  FROM search_index WHERE search_index MATCH %s"
            "), "
            "numbered AS ("
            "  SELECT *, ROW_NUMBER() OVER (PARTITION BY type ORDER BY score) AS rn "
            "  FROM ranked"
            ") "
            "SELECT type, object_id, title, subtitle, url, extra, created_at, snip "
            "FROM numbered WHERE rn <= %s ORDER BY type, rn",
            [fts_query, per_type_limit],
        )
        return [_parse_fts_row(row) for row in cursor.fetchall()]
