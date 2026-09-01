# Plan 007: Repo hygiene — archive implemented PRDs, guard against artifact commits, list local cleanup

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 023ad2c..HEAD -- madtilmeldingsplan.md medlemskabsplan.md seed.data.md .gitignore`
> On mismatch, STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (plan 006 references these files' new location only loosely; order doesn't matter)
- **Category**: tech-debt
- **Planned at**: commit `023ad2c`, 2026-06-12

## Why this matters

The repo root mixes living docs with finished one-offs and (locally) with untracked data dumps. The git-tracked offenders are two **implemented** PRDs (`madtilmeldingsplan.md` — mixed meal types, shipped: `adults_meat` exists in `backend/apps/food/models.py`; `medlemskabsplan.md` — group membership/private threads, shipped: `SubgroupMembership` at `backend/apps/forum/models.py:521`) plus `seed.data.md`. Leaving shipped PRDs in the root invites agents and humans to treat them as open work. Separately, several untracked local artifacts (a 28 MB media export, import zips, a dead `calendar_app` directory) clutter the working tree on the maintainer's machine — an executor cannot see or delete those (they're untracked, invisible in a worktree), so this plan handles tracked files and leaves the operator a precise local-cleanup checklist.

## Current state

Git-tracked root files in scope (verified via `git ls-files`):

- `madtilmeldingsplan.md` — PRD for mixed meal types + partial ticket selling. Implemented (verify: `grep -c adults_meat backend/apps/food/models.py` → ≥1).
- `medlemskabsplan.md` — PRD for group membership + private threads. Implemented (verify: `grep -n "class SubgroupMembership" backend/apps/forum/models.py` → 1 hit).
- `seed.data.md` — seed-data notes.

NOT tracked by git (do not try to move/delete — they exist only on the operator's machine): `kloeverbakken-export-2026-04-20-7b0cf140/` (28 MB), `bookings-import-20260528.zip`, `old_food_teams/`, `-bookingsystemet-2026-flyttes-til-kb-intradk-31-5-20260528-031836-d9882f/`, `backend/apps/calendar_app/` (only `__pycache__` inside).

`docs/` currently holds `architecture.md` and `daphne-segfault.md`. `.gitignore` already covers `.env*` variants; it does not cover export/import artifact patterns.

## Commands you will need

| Purpose | Command (from repo root) | Expected on success |
|---|---|---|
| Confirm tracked status | `git ls-files madtilmeldingsplan.md medlemskabsplan.md seed.data.md` | 3 lines |
| Move with history | `git mv <file> docs/history/<file>` | exit 0 |
| Backend untouched | `cd backend && uv run pytest -q \| tail -2` | all pass |

## Scope

**In scope**: `madtilmeldingsplan.md`, `medlemskabsplan.md`, `seed.data.md` (moves), `docs/history/` (create), `.gitignore` (additions), `docs/history/README.md` (create, 3 lines).

**Out of scope**:

- Untracked local files/directories — operator checklist only (Maintenance notes). NEVER run `git clean` or delete untracked paths.
- `bugs/`, `maintenance/`, `loadtest/`, `MANUAL_TEST_GUIDE.md`, `DEPLOY.md`, `INSTALL.md`, `SENTRY.md`, `LICENSE.md` — live operational docs/dirs, leave alone.
- Git history rewrites.

## Git workflow

- Branch: `advisor/007-repo-hygiene`
- One commit: `chore: archive implemented PRDs to docs/history, ignore data-export artifacts`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Verify both PRDs are implemented

Run the two verification greps from "Current state". If either returns nothing, that PRD may NOT be shipped — STOP and report which one.

### Step 2: Archive the PRDs and seed notes

```
mkdir -p docs/history
git mv madtilmeldingsplan.md docs/history/
git mv medlemskabsplan.md docs/history/
git mv seed.data.md docs/history/
```

Create `docs/history/README.md`:

```markdown
# Historical documents

Shipped PRDs and one-off notes, kept for the decision record. Nothing here is open work.
```

**Verify**: `git status` shows 3 renames + 1 new file; `ls *.md` in repo root no longer lists the three.

### Step 3: Search for inbound references

`git grep -ln "madtilmeldingsplan\|medlemskabsplan\|seed.data.md" -- ':!docs/history' ':!plans'` — if any file references the old paths, update those references to `docs/history/...`. (CLAUDE.md and README are the likely candidates; plans/ files may mention them descriptively — leave plans/ alone.)

**Verify**: the same grep returns no matches outside `docs/history` and `plans/`.

### Step 4: Guard against future artifact commits

Append to `.gitignore`:

```
# Local data dumps / one-off import-export artifacts — never commit
kloeverbakken-export-*/
*-import-*.zip
old_food_teams/
```

**Verify**: `git check-ignore -v bookings-import-20260528.zip` → matches the new rule.

## Test plan

`cd backend && uv run pytest -q | tail -2` → unchanged pass count (nothing executable touched). The greps in Steps 3–4 are the functional checks.

## Done criteria

- [ ] Repo root contains no PRD/seed markdown (`ls *.md` → README, CLAUDE, DEPLOY, INSTALL, LICENSE, MANUAL_TEST_GUIDE, SENTRY only)
- [ ] `git log --follow docs/history/medlemskabsplan.md` shows pre-move history (rename detected)
- [ ] `git check-ignore` matches the three new patterns
- [ ] Backend test suite unchanged
- [ ] `plans/README.md` status row updated

## STOP conditions

- Step 1's implementation check fails for either PRD.
- Any code file (not docs) references the moved files by path.

## Maintenance notes — OPERATOR LOCAL CLEANUP (manual, not for the executor)

On the machine that hosts the working tree, after confirming backups exist elsewhere:

- `rm -rf backend/apps/calendar_app` — dead, unregistered, only `__pycache__` inside (it is NOT in `INSTALLED_APPS`, `backend/config/settings.py:46-74`).
- Review then remove: `kloeverbakken-export-2026-04-20-7b0cf140/` (28 MB — confirm this export is preserved in the backup system before deleting), `bookings-import-20260528.zip`, `old_food_teams/`, and the stray `-bookingsystemet-2026-flyttes-til-kb-intradk-31-5-20260528-031836-d9882f/` directory.
- Reviewer: nothing in this PR should delete data — it only moves markdown and edits `.gitignore`.
