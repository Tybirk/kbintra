# Plan 006: Bring CLAUDE.md and README.md in line with the actual codebase

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 023ad2c..HEAD -- CLAUDE.md README.md backend/config/settings.py backend/config/urls.py`
> On mismatch, re-derive the app/route lists from the live files (Step 1 does
> exactly that), and only STOP if `INSTALLED_APPS` itself is mid-refactor.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (docs only)
- **Depends on**: none (if plan 001 landed, also add its sanitization rule — see Step 3)
- **Category**: docs
- **Planned at**: commit `023ad2c`, 2026-06-12

## Why this matters

This repo is explicitly maintained with heavy agent assistance, and `CLAUDE.md` is the context every agent session starts from. It currently describes **8 Django apps**; the codebase has **12 registered apps** (plus a dead unregistered `calendar_app` directory). `events`, `bookings`, `links`, `search`, and `backup` — including the booking system, one of the most actively developed features — are invisible to any agent that trusts the docs. README.md repeats the same stale structure. Wrong docs are worse than no docs: agents plan against a map that's missing a third of the territory.

## Current state

- `CLAUDE.md` "Backend Structure" section: "8 Django apps in `backend/apps/`" listing users, houses, forum, food, announcements, calendar_app, messaging, notifications. The "API & Real-time" section lists REST endpoints `/api/{auth,users,houses,forum,announcements,food,calendar,messages,notifications}/`.
- Ground truth — `backend/config/settings.py:61-73` (`INSTALLED_APPS`, local apps): `users, houses, forum, announcements, food, events, messaging, notifications, search, bookings, links, backup`. There is **no `calendar_app`** in `INSTALLED_APPS`; the directory `backend/apps/calendar_app/` contains only `__pycache__` leftovers (plan 007 removes the local dir; it is not tracked in git).
- Ground truth — `backend/config/urls.py:85-108`: routes are `api/health, admin, api/auth/token, api/auth/token/refresh, api/auth, api/users, api/houses, api/forum, api/announcements, api/food, api/events, api/messages, api/notifications, api/search, api/bookings, api/links, media`. There is **no `/api/calendar/`**.
- `README.md:18-48` "Project Structure" diagram: lists the same stale 8 apps (with `calendar_app/ # Community calendar`).
- Conventions: CLAUDE.md is terse and pattern-oriented; keep that register. All user-facing app text is Danish but docs are English.

## Commands you will need

| Purpose | Command (from repo root) | Expected on success |
|---|---|---|
| Ground-truth apps | `grep -A30 "INSTALLED_APPS" backend/config/settings.py \| grep '"apps\.'` | 12 lines |
| Ground-truth routes | `grep -n "path(" backend/config/urls.py` | matches the list above |
| One-line descriptions | read each app's `models.py`/`views.py` docstrings as needed | — |
| No stale references | `grep -rn "calendar_app\|api/calendar" CLAUDE.md README.md` | no matches after Step 2 |

## Scope

**In scope**: `CLAUDE.md`, `README.md`.

**Out of scope**:

- `docs/architecture.md` — verified current at planning time (it already documents the gunicorn/daphne split, Huey, search, encryption).
- Code, settings, URLs — read-only ground truth.
- Restructuring CLAUDE.md or adding new sections beyond what's listed (resist the urge to rewrite; the goal is accuracy, not authorship).

## Git workflow

- Branch: `advisor/006-refresh-stale-docs`
- One commit: `docs: update CLAUDE.md/README app list to match codebase`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Derive the authoritative lists

Run the two ground-truth commands above. For each of the 12 apps, write a one-line description by skimming its `models.py` (e.g. `events` — community events + RSVPs + reminders; `bookings` — bookable rooms/resources with recurring bookings and overlap validation; `links` — shared community links; `search` — FTS5 global search; `backup` — S3 backup endpoints/automation: confirm by reading `backend/apps/backup/views.py:1-30`).

### Step 2: Update CLAUDE.md

- "Backend Structure": replace the 8-app list with the 12 registered apps + one-liners. Remove `calendar_app`.
- "API & Real-time": replace the endpoint list with the actual routes from `urls.py` (add `events`, `search`, `bookings`, `links`; remove `calendar`).
- "Project Overview" first paragraph: mention bookings and events alongside the existing feature list.
- Scan the rest of CLAUDE.md for references to removed/renamed things: `grep -n "calendar" CLAUDE.md` — the "Periodic background tasks" section correctly says `apps/events/tasks.py`; leave it.

**Verify**: `grep -rn "calendar_app\|api/calendar" CLAUDE.md` → no matches; `grep -c "apps/" CLAUDE.md` sanity-check the section lists 12 apps.

### Step 3 (conditional): Record the sanitization rule from plan 001

Check `plans/README.md`: if plan 001 is DONE (or its branch is merged — `git log --oneline --all | grep -i sanitiz`), add one bullet to CLAUDE.md's "Important Patterns & Gotchas":

```
### User HTML sanitization
All user-supplied HTML fields must pass through `apps.common.sanitization.sanitize_user_html()` in the model's `save()`. New rich-text fields must do the same — see `backend/apps/common/sanitization.py`.
```

If plan 001 is not yet done, skip this step and note it in the plans/README.md status row ("001's CLAUDE.md note still pending").

### Step 4: Update README.md

Replace the stale apps in the "Project Structure" tree with the 12 real ones (same one-liners, terser). Keep the rest of the README untouched.

**Verify**: `grep -rn "calendar_app" README.md` → no matches.

## Test plan

Docs-only; the greps in Steps 2/4 are the tests. Additionally run `cd backend && uv run pytest -x -q | tail -2` once to confirm you touched nothing executable.

## Done criteria

- [ ] `grep -rn "calendar_app\|api/calendar" CLAUDE.md README.md` → no matches
- [ ] CLAUDE.md lists exactly the 12 apps from `INSTALLED_APPS`, each with a description
- [ ] CLAUDE.md endpoint list matches `backend/config/urls.py`
- [ ] `git diff --stat` touches only CLAUDE.md and README.md
- [ ] `plans/README.md` status row updated

## STOP conditions

- `INSTALLED_APPS` contains apps not present in `backend/apps/` or vice versa (mid-refactor) — report instead of documenting a moving target.
- You feel the need to rewrite sections beyond the app/route lists — that's scope creep; report what else you think is stale instead.

## Maintenance notes

- CLAUDE.md app list will drift again; the cheap guard is the habit "adding an app = one line in CLAUDE.md" — consider appending that to CLAUDE.md's "Adding New Models or Columns" section while in there (one sentence).
- Reviewer: diff-check that descriptions match what the apps actually do, not what their names suggest (`backup` especially — read the code, don't guess).
