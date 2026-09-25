# 004 — Lifecycle metadata + archiving

**Type:** AFK

## Parent

docs/grafisk-overblik-plan.md

## What to build

Add working-group lifecycle metadata and archiving. Subgroups gain an official
creation date, an optional expiry date, and an active flag. Marking an arbejdsgruppe as
**afsluttet** archives it: it disappears from the forum list by default (with an opt-in
"vis arkiverede" path), while the group page stays reachable by its URL. Dates are shown
on the group page.

End state: closing a finished arbejdsgruppe keeps `/forum` from drowning in stale groups
over time, without destroying anything.

## Acceptance criteria

- [ ] `Subgroup` gains `established_on` (date, nullable), `expires_on` (date, nullable), `is_active` (bool, default `True`, `db_index=True`).
- [ ] `SubgroupSerializer` exposes all three; create/update serializers accept them.
- [ ] The `/forum` subgroup list filters `is_active=True` by default; `?include_archived=true` returns archived groups too.
- [ ] `SubgroupPage.tsx` has a "Markér som afsluttet" / "Genåbn" action and shows `established_on`/`expires_on`. Permission reuses the type-aware rule from slice 003: for an arbejdsgruppe any authenticated user may toggle `is_active`; for an organ it requires staff or membership (organs are not normally archived, but the gate must hold).
- [ ] `ForumPage.tsx` hides archived groups by default (consumes the default filter).
- [ ] Django admin exposes `established_on`, `expires_on`, `is_active`.
- [ ] Tests: archived groups excluded from `/forum` by default and included with the flag; the afslut/genåbn action works.
- [ ] All required backend + frontend checks pass.

## Blocked by

- plans/grafisk-overblik/slices/001-group-type-spine.md
- plans/grafisk-overblik/slices/003-parent-children-hierarchy.md

Land **after** 003 (not in parallel): both add columns to `Subgroup`, so running
`makemigrations forum` on two branches off 001 would produce conflicting leaf migrations.
This slice's lifecycle migration stacks on top of 003's `parent` migration, and its
archive action reuses the type-aware permission logic introduced in 003.

## User stories covered

12 (markér som afsluttet), 16 (afsluttede arbejdsgruppers forumgrupper skjules); supports
6 and 10.
