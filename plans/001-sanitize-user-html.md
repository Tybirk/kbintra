# Plan 001: Sanitize all user-supplied HTML server-side (stored-XSS fix)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 023ad2c..HEAD -- backend/apps/forum backend/apps/announcements backend/apps/events backend/apps/messaging frontend/src/components/RichTextContent.tsx frontend/src/components/FilePreview.tsx frontend/src/components/AttachmentCarousel.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (sanitizer allowlist could strip legitimate markup — covered by tests)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `023ad2c`, 2026-06-12

## Why this matters

KB Intra stores user-supplied HTML (Tiptap rich text and DOCX-to-HTML previews) completely unsanitized and renders it in the frontend via `dangerouslySetInnerHTML`. There is no sanitization library anywhere in the backend (verified: no bleach/nh3/dompurify in `backend/pyproject.toml` or `frontend/package.json`). Any authenticated resident can `POST` raw `<script>` tags directly to the API (bypassing the Tiptap editor), and JWTs — including the 7-day refresh token — are stored in `localStorage` (`frontend/src/api/client.ts:164-174`). One malicious forum post is therefore a stored-XSS → full account takeover of every resident who views it. This plan adds server-side sanitization at write time (the authoritative fix), a backfill command for existing content, and client-side DOMPurify as defense in depth.

## Current state

Relevant files:

- `backend/apps/forum/models.py` — `Subgroup.links_info` + `Subgroup.links_info_members` (rich text fields, ~lines 20–29), `Post.content` (line 179), `preview_html` fields at lines 227 and 478.
- `backend/apps/announcements/models.py` — `Announcement.content` (line 13), `preview_html` (line 62).
- `backend/apps/events/models.py` — `Event.description` (line 21).
- `backend/apps/messaging/models.py` — attachment `preview_html` (line 132). NOTE: `Message.content` (line 47) is an `EncryptedTextField` rendered as plain text in the frontend — it is **out of scope**, do not touch it.
- `backend/apps/forum/utils.py:55-98` — `generate_docx_preview()` returns `mammoth.convert_to_html(file_field)` output **raw** (line 94-95). This is the single source of all `preview_html` values (called from `forum/serializers.py:37`, `announcements/serializers.py:152`, `messaging/serializers.py:346`).
- `frontend/src/components/RichTextContent.tsx:45` — `dangerouslySetInnerHTML={{ __html: html }}` renders post/announcement/event/links HTML. Used by `ThreadPage`, `SubgroupPage`, `AnnouncementsPage`, `EventHeader`, `LinksPage`.
- `frontend/src/components/FilePreview.tsx:571` and `frontend/src/components/AttachmentCarousel.tsx:548` — render `preview_html` via `dangerouslySetInnerHTML`.

Current code in `backend/apps/forum/utils.py:89-98`:

```python
    try:
        import mammoth

        # Read the file and convert to HTML
        file_field.seek(0)
        result = mammoth.convert_to_html(file_field)
        return result.value
    except Exception as e:
        logger.warning(f"Failed to generate DOCX preview for {file_field.name}: {e}")
        return ""
```

Tiptap markup the sanitizer MUST preserve (the editor at `frontend/src/components/RichTextEditor.tsx` uses StarterKit, Image, Link, Mention extensions):

- Standard formatting: `p, br, strong, b, em, i, u, s, code, pre, blockquote, h1–h6, ul, ol, li, hr, mark`
- Links: `<a href target rel title>`
- Images (uploads + GIFs): `<img src alt title width height>`
- **Mentions**: `<span data-type="mention" data-id="42" data-label="...">`. The backend parses these with `apps/notifications/utils.py:extract_mention_ids()` (regex on `data-type="mention"` + `data-id`). If the sanitizer strips `data-id`/`data-type`, mention notifications break.

Repo conventions: Python is Django 5 + DRF, lint with ruff (line-length 100), type-check with `uvx ty check`. Tests are pytest-django in each app's `tests.py`. Cross-app shared helpers already exist as plain imports (e.g. `forum/serializers.py` imports from `apps.notifications.utils`). ALL user-facing strings must be Danish, but this plan has no user-facing strings.

## Commands you will need

| Purpose | Command (run from `/backend` unless noted) | Expected on success |
|---|---|---|
| Install backend dep | `uv add nh3` | exit 0, `nh3` added to pyproject.toml |
| Backend tests | `uv run pytest` | all pass (692+ collected) |
| Targeted tests | `uv run pytest apps/forum/tests.py -v -k sanitiz` | new tests pass |
| Lint | `uv run ruff check --fix . && uv run ruff format .` | exit 0 |
| Typecheck | `uvx ty check` | exit 0 |
| Frontend install (from `/frontend`) | `npm install dompurify && npm install -D @types/dompurify` | exit 0 |
| Frontend checks (from `/frontend`) | `npm run typecheck && npm run lint && npm run format:check && npm run test:run` | all exit 0 |

## Scope

**In scope** (the only files you should modify/create):

- `backend/apps/common/__init__.py` (create — plain package, NOT a registered Django app)
- `backend/apps/common/sanitization.py` (create)
- `backend/apps/forum/models.py`, `backend/apps/announcements/models.py`, `backend/apps/events/models.py` (add `save()` sanitization)
- `backend/apps/forum/utils.py` (sanitize mammoth output)
- `backend/apps/forum/management/commands/sanitize_html.py` (create backfill command)
- `backend/apps/forum/tests.py`, `backend/apps/announcements/tests.py` (add tests)
- `backend/pyproject.toml` / `uv.lock` (via `uv add nh3` only)
- `frontend/src/components/RichTextContent.tsx`, `FilePreview.tsx`, `AttachmentCarousel.tsx`, `frontend/package.json`/`package-lock.json` (DOMPurify)

**Out of scope** (do NOT touch):

- `backend/apps/messaging/models.py` `Message.content` / `EncryptedTextField` — messages are rendered as plain text; sanitizing inside encryption is needless risk.
- `backend/apps/search/` — the FTS index re-syncs via `post_save` signals automatically when the backfill re-saves rows; do not modify search code.
- The Tiptap editor configuration (`RichTextEditor.tsx`) — client-side editor output is irrelevant to the server-side trust boundary.
- Any Django migration — no schema changes in this plan.

## Git workflow

- Branch: `advisor/001-sanitize-user-html`
- Commit style is short lowercase imperative (repo examples: "fix banner placement", "handle midnight gracefully").
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the sanitization helper

`uv add nh3` (run in `/backend`). Create `backend/apps/common/__init__.py` (empty) and `backend/apps/common/sanitization.py`:

```python
"""Central HTML sanitization for all user-supplied rich text.

Every field that stores user HTML (forum posts, announcement content, event
descriptions, subgroup links-info, DOCX previews) must pass through
sanitize_user_html() before persistence. The allowlist mirrors what the
Tiptap editor (StarterKit + Image + Link + Mention) can produce.
"""

import nh3

ALLOWED_TAGS = {
    "p", "br", "strong", "b", "em", "i", "u", "s", "strike", "code", "pre",
    "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "hr",
    "a", "img", "span", "mark", "div", "table", "thead", "tbody", "tr", "th", "td",
}

ALLOWED_ATTRIBUTES = {
    "a": {"href", "target", "rel", "title"},
    "img": {"src", "alt", "title", "width", "height"},
    # Tiptap mention spans: apps/notifications/utils.py parses data-type + data-id.
    "span": {"data-type", "data-id", "data-label", "class"},
    "div": {"class"},
}


def sanitize_user_html(html: str) -> str:
    if not html:
        return html
    return nh3.clean(
        html,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        link_rel="noopener noreferrer",
    )
```

(`table`/`div` are included because mammoth emits them for DOCX tables; nh3's default URL filtering already strips `javascript:` URLs and keeps relative `/media/...` URLs.)

**Verify**: `uv run python -c "from apps.common.sanitization import sanitize_user_html; print(sanitize_user_html('<p>ok</p><script>alert(1)</script><span data-type=\"mention\" data-id=\"42\">@x</span>'))"` → output contains `<p>ok</p>` and `data-id="42"`, and does NOT contain `<script>`.

### Step 2: Sanitize at model save for the four HTML-bearing models

In each model below, add/extend `save()` to sanitize before persisting. Pattern:

```python
from apps.common.sanitization import sanitize_user_html

    def save(self, *args, **kwargs):
        self.content = sanitize_user_html(self.content)
        super().save(*args, **kwargs)
```

Apply to:

1. `backend/apps/forum/models.py` — `Post.save()`: sanitize `self.content`. `Subgroup.save()`: sanitize `self.links_info` and `self.links_info_members`. NOTE: `Subgroup.save()` may already exist (it generates slugs) — extend it, don't replace it. Same for `Post` if a `save()` exists.
2. `backend/apps/announcements/models.py` — `Announcement.save()`: sanitize `self.content`.
3. `backend/apps/events/models.py` — `Event.save()`: sanitize `self.description`.

If a model also has a `preview_html` field set via `generate_docx_preview`, do NOT add per-field sanitization there — Step 3 fixes it at the source.

**Verify**: `uv run pytest` → all existing tests pass (mention-notification tests in forum will catch over-stripping of mention spans).

### Step 3: Sanitize DOCX preview output at the source

In `backend/apps/forum/utils.py`, change line 95 (`return result.value`) to:

```python
        from apps.common.sanitization import sanitize_user_html

        return sanitize_user_html(result.value)
```

This covers all three callers (forum, announcements, messaging attachments).

**Verify**: `uv run ruff check . && uv run pytest apps/forum/tests.py` → exit 0.

### Step 4: Backfill existing content

Create `backend/apps/forum/management/commands/sanitize_html.py` (forum already has a `management/commands/` directory — model the command class on an existing command there, e.g. the search rebuild command's structure in `apps/search/management/commands/rebuild_search_index.py`). The command must:

- Iterate `Post` (field `content`), `Subgroup` (`links_info`, `links_info_members`), `Announcement` (`content`), `Event` (`description`), and every model with a `preview_html` field (forum models at lines 227/478, announcements attachment, messaging attachment — find them with `grep -rn "preview_html = models" backend/apps`).
- For each row, compute the sanitized value; if it differs, write it with `.save()` (so search-index signals fire) — for `preview_html`-only models a bulk `update` is fine since they're not in the search index (verify with `grep -n preview_html backend/apps/search/signals.py`; if they ARE indexed, use `.save()`).
- Print a per-model count of changed rows; support `--dry-run` (print counts, write nothing).

**Verify**: `uv run python manage.py sanitize_html --dry-run` against the dev DB → runs to completion, prints counts, exit 0.

### Step 5: Backend tests

See Test plan below. **Verify**: `uv run pytest -k sanitiz -v` → new tests pass; `uv run pytest` → full suite passes.

### Step 6: Frontend defense in depth (DOMPurify)

From `/frontend`: `npm install dompurify` (types are bundled with dompurify v3; only add `@types/dompurify` if `npm run typecheck` complains). Then sanitize at the three render sites:

- `RichTextContent.tsx:45`: `dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html, { ADD_ATTR: ["data-type", "data-id", "data-label", "target"] }) }}`
- `FilePreview.tsx:571` and `AttachmentCarousel.tsx:548`: same pattern on `preview_html`.

Keep it inline at each site (3 call sites; do not build an abstraction). Remember the CLAUDE.md rule: no inline object types inside generics (not applicable here, but oxfmt will run).

**Verify**: `npm run typecheck && npm run lint && npm run format:check && npm run test:run` → all exit 0.

## Test plan

New backend tests (model after existing API tests in the same files — they use pytest-django with an authenticated API client fixture from `backend/conftest.py`):

In `backend/apps/forum/tests.py`, class `TestHtmlSanitization`:

1. Unit: `sanitize_user_html` strips `<script>`, `onerror=` attributes, and `javascript:` hrefs; preserves `<p>`, `<a href="https://...">`, `<img src="/media/x.png">`.
2. Unit: mention span `<span data-type="mention" data-id="42" data-label="Bo">@Bo</span>` survives sanitization byte-meaningfully (i.e. `extract_mention_ids` from `apps.notifications.utils` still returns `[42]` on the sanitized output).
3. API: POST a forum post (existing post-creation test as pattern) with `content` containing `<script>alert(1)</script><p>hej</p>` → response 201 and the stored `Post.content` contains `<p>hej</p>` but not `<script`.

In `backend/apps/announcements/tests.py`: same API-level test for announcement `content`.

Verification: `cd backend && uv run pytest` → all pass including ≥4 new tests.

## Done criteria

- [ ] `cd backend && uv run pytest` exits 0, with ≥4 new sanitization tests
- [ ] `cd backend && uv run ruff check . && uv run ruff format --check .` exit 0
- [ ] `uvx ty check` exits 0 (run in `/backend`)
- [ ] `uv run python -c "..."` smoke test from Step 1 strips `<script>` and keeps `data-id`
- [ ] `uv run python manage.py sanitize_html --dry-run` exits 0
- [ ] `cd frontend && npm run typecheck && npm run lint && npm run format:check && npm run test:run` all exit 0
- [ ] `grep -n "dangerouslySetInnerHTML" frontend/src -r` → every hit wrapped in `DOMPurify.sanitize`
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- A `save()` override already exists on `Post`, `Subgroup`, `Announcement`, or `Event` and does something you don't understand — report what you found instead of merging blindly.
- Existing mention-notification tests fail after Step 2 (the allowlist is stripping something Tiptap needs — report the failing HTML).
- `nh3` cannot be installed via `uv add` (network/platform issue).
- You find additional `dangerouslySetInnerHTML` sites beyond the three listed — report them; do not silently expand scope.
- `preview_html` models turn out to be in the search index AND `.save()` backfill on them errors.

## Maintenance notes

- Any NEW model field that stores user HTML must call `sanitize_user_html` in `save()` — add this rule to CLAUDE.md's "Adding New Models or Columns" section when plan 006 (docs refresh) runs, or in this PR if 006 already landed.
- Reviewer should scrutinize the allowlist vs. real Tiptap output: paste an existing production-like post through the sanitizer and diff. Especially check image resizing attributes and Giphy embeds.
- Deferred: rate-limiting/virus-scanning uploads, and sanitizing historical `Message.content` (plain-text rendered; revisit only if messages ever get rich-text rendering).
- The operator must run `python manage.py sanitize_html` once in production after deploy (document in the PR description).
