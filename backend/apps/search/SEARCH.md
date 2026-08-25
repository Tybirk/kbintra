# Full-Text Search (FTS5)

Global search using SQLite FTS5. No external search engine needed.

## Architecture

A single FTS5 virtual table `search_index` stores all searchable content. Django signals keep it in sync on every save/delete, and a management command provides full rebuild capability.

### FTS5 Table Schema

```sql
CREATE VIRTUAL TABLE search_index USING fts5(
    title,                    -- Full-text indexed (BM25 weight: 10.0)
    body,                     -- Full-text indexed (BM25 weight: 1.0)
    type UNINDEXED,           -- "user", "thread", "post", etc.
    object_id UNINDEXED,      -- ID in the source model
    url UNINDEXED,            -- Frontend route
    subtitle UNINDEXED,       -- Display subtitle
    extra UNINDEXED,          -- JSON blob (e.g. {"thread_id": 42})
    created_at UNINDEXED,     -- ISO 8601 timestamp for recency ranking
    tokenize='unicode61 remove_diacritics 2'
);
```

Only `title` and `body` are full-text indexed. All other columns are stored but not searchable via MATCH.

### Ranking

Results are ordered by:

```sql
bm25(search_index, 10.0, 1.0)
  + CASE
    WHEN type IN ('thread','post','announcement','event','file','report')
      THEN 0.01 * age_in_days    -- ~3.65/year (strong decay)
    ELSE  0.001 * age_in_days    -- ~0.365/year (mild tiebreaker)
    END
```

- **BM25**: Title matches weighted 10x over body. Returns negative values (more negative = better).
- **Content types** (threads, posts, announcements, events, files, reports): Strong recency decay. A 6-month-old post is penalized ~1.8 points; a 2-year-old post ~7.3. Older content is significantly downranked.
- **Static types** (users, houses, subgroups): Mild tiebreaker only. These rarely go stale.

### Query Building

User input is sanitized and converted to FTS5 prefix queries:
- `"community mee"` becomes `"community"* "mee"*`
- FTS5 special characters are stripped
- Tokens are implicitly ANDed (all must match)

### Danish character folding (æøå ↔ ae/oe/aa)

FTS5's `unicode61 remove_diacritics 2` tokenizer folds combining diacritics
(e.g. `é → e`), but æ/ø/å are independent Unicode letters and are NOT folded.
To make search work in both directions (`Kløverbakkebogen` finds
`Kloeverbakkebogen` and vice versa), `fold_danish()` is applied:

- **At index time** (`index_object`) — `title` and `body` are stored with
  `æ→ae, ø→oe, å→aa`. The `subtitle` is left unfolded since it is displayed
  verbatim and not searched.
- **At query time** (`build_fts_query`) — incoming queries are folded the
  same way before tokenization.

A consequence is that titles displayed from FTS results show the folded form
(`Møde` → `Moede`). For the small KB user base this trade-off is acceptable;
clicking through to the actual record shows the original spelling.

**After deploying changes that affect folding or indexing**, run
`uv run python manage.py rebuild_search_index` once to repopulate existing
rows with the new format. Subsequent saves go through the signals and stay
in sync incrementally.

### Per-type bucketing

`/api/search/` calls `fts_search_per_type(query, per_type_limit)` rather than
a single global top-K. The function uses `ROW_NUMBER() OVER (PARTITION BY
type ORDER BY score)` so each type gets its own top-N in one SQL statement.
Without this, queries like `Dagsorden` — which matches 1000+ files whose
filenames contain the term — fill the entire global result pool with files
and leave threads/posts/announcements with zero hits.

## Key Files

| File | Purpose |
|------|---------|
| `services.py` | Core functions: `index_object()`, `remove_object()`, `fts_search()`, `build_fts_query()` |
| `signals.py` | Auto-indexing on model save/delete. Logs errors via `logging.exception`. |
| `views.py` | API endpoint (`GET /api/search/?q=&limit=`) with heuristic shortcuts |
| `migrations/0001_create_fts5_search_index.py` | Creates FTS5 virtual table |
| `migrations/0002_add_created_at_to_search_index.py` | Adds `created_at` column for recency ranking |
| `management/commands/rebuild_search_index.py` | Full reindex command |
| `frontend/src/components/GlobalSearch.tsx` | Mantine Spotlight search UI |

## Indexed Models

| Model | Type Key | `created_at` Source | Title | Body |
|-------|----------|---------------------|-------|------|
| User | `user` | `date_joined` | Full name | Email |
| House | `house` | `created_at` | Name | Description (stripped HTML) |
| Car | `car` | `created_at` | Plate ("AB 12 345") | House name + compact plate ("AB12345") |
| Thread | `thread` | `created_at` | Title | First post content (stripped HTML) |
| Post | `post` | `created_at` | Thread title | Content (stripped HTML) |
| Subgroup | `subgroup` | `created_at` | Name | Description (stripped HTML) |
| Announcement | `announcement` | `created_at` | Title | Content (stripped HTML) |
| Event | `event` | `created_at` | Title | Description + location |
| File | `file` | `uploaded_at` | Filename | (empty) |
| Folder | `folder` | `created_at` | Name | (empty) |
| Report | `report` | `created_at` | Description excerpt (80 chars) | Description + location |

## API Heuristics

The search endpoint combines FTS5 results with three heuristic shortcuts:

1. **House number lookup** (query is a digit 1-62): Direct DB lookup of houses by name suffix + their residents. Enables single-character search for house numbers.

2. **User name priority** (query >= 2 chars): `istartswith` on first/last name injected at top of user results. Ensures typing a name prefix always surfaces the right person.

3. **Subgroup name matching** (query >= 2 chars): `icontains` on subgroup name injected at top. Ensures forum names are always findable.

## Signal Cascading

When a **Thread** is saved, the signal also re-indexes all its posts so they pick up any title change. Other cascading (e.g., user house change) relies on the next `rebuild_search_index` run.

## Management Commands

```bash
# Full rebuild (clears and re-indexes everything)
uv run python manage.py rebuild_search_index

# Conditional rebuild (skips if index already has entries)
uv run python manage.py rebuild_search_index --if-empty
```

The `--if-empty` variant is used in `docker-entrypoint.sh` on container startup.

**Note on schema migrations**: FTS5 virtual tables cannot be ALTERed. Adding a column requires DROP + CREATE, which empties the index. During deploy there is a brief window between migration (DROP/CREATE) and `rebuild_search_index --if-empty` (repopulates) where the index is empty. For our single-server setup this is fine — the rebuild runs immediately after migration in `docker-entrypoint.sh`.

## Adding a New Searchable Model

1. Add `post_save` / `post_delete` signal pair in `signals.py` calling `index_object()` / `remove_object()`
2. Add indexing logic to `rebuild_search_index.py`
3. Add the type to `TYPE_TO_KEY` in `views.py`
4. Add the type to the `ensure_all_keys` list in `views.py`
