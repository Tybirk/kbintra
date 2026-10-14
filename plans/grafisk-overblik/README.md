# Grafisk overblik — implementation slices

Vertical slices implementing `docs/grafisk-overblik-plan.md` (PRD: grafisk overblik over
foreningens organer + arbejdsgrupper). Each slice is **full-stack and independently
shippable** as a PR-sized chunk; they're built separately but rolled out together
(see the PRD's "Faser, én udrulning").

Each executor: read the slice fully (and the PRD) before starting, honor its acceptance
criteria, and update your row's Status when done.

## Execution order & status

| Slice | Title | Effort | Depends on (functional) | Status |
|-------|-------|--------|--------------------------|--------|
| 001 | `group_type` classification spine (replace `is_committee`) | M | — | TODO |
| 002 | Generalforsamling + Fællesmøde organer, all users subscribed | S | 001 | TODO |
| 003 | Parent/children hierarchy (soft, nav-only) | M | 001 | TODO |
| 004 | Lifecycle metadata + archiving (`is_active`, dates) | S–M | 001, 003 | TODO |
| 005 | `/overblik` page + `/api/forum/organisation/` endpoint | M | 003, 004 | TODO |
| 006 | Create arbejdsgruppe/almindelig from the UI | M | 003, 004, 005 | TODO |
| 007 | Browser QA pass (agent-driven, `claude --chrome`) | M | 001–006 | TODO |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (one-line reason) | REJECTED (rationale).

## Dependency graph

```
001 ─┬─ 002 ─────────────────────────────┐
     ├─ 003 ─┬─ 004 ─┬─ 005 ─── 006 ──────┤
     │       └───────┘                    │
     └────────────────────────────────────┴─ 007 (browser QA over the whole feature)
```

- **001 is the spine** — the `is_committee → group_type` swap every later slice builds on.
- **002** (the two top organer + subscription backfill) only needs 001 functionally, but see
  the migration-chain note below.
- **003 → 004 → 005 → 006** is the main line: hierarchy → lifecycle/archiving → the overblik
  read view → the create UI.
- **007** is the final end-to-end browser pass; it needs everything landed.

## Landing order & the forum migration chain

Land the slices in **numeric order: 001 → 002 → 003 → 004 → 005 → 006 → 007.**

Slices **001, 002, 003, 004 each add a migration to the `forum` app.** Migrations form a
single linear history, so they must land one after another — two branches running
`makemigrations forum` off the same parent produce conflicting leaf migrations. Landing in
numeric order keeps the history a clean chain. If you ever reorder or land two of them in
parallel, resolve it with `uv run python manage.py makemigrations --merge` (and re-test
`migrate` from scratch on an empty DB, since CI migrates a fresh database).

005 and 006 add **no** migrations (endpoint + UI only), so they don't participate in the
chain — but they still depend on the earlier slices' code.

## Operator / admin actions (not automated)

- **Organ types are created/renamed/reparented and groups are deleted only in Django admin**
  (slices 001/003 add the admin fields). Menige brugere kan kun oprette arbejdsgrupper/
  almindelige grupper i app'en.
- **Slice 002 backfills subscriptions** for the ~90 current users via a data migration
  (mirrors `0041`); `is_default` alone only covers future users.
- **Slice 007 needs seeded fixtures** (organer, ≥2-level arbejdsgrupper, an archived group
  *with an active child*, an almindelig gruppe) and three personas (staff / organ-member /
  non-member). Build the organ structure via Django admin; build arbejdsgrupper via the
  slice-006 UI.
- **Report back on the prod thread** when the feature lands (see PRD top), and confirm the
  design with HC/Bestyrelsen if anything diverged.

## Do-not-touch

- Historical forum migrations `0003/0005/0007/0029` reference `is_committee` against their
  **frozen** model state (`apps.get_model`). They are correct and must stay untouched —
  only current code migrates from `is_committee` to `group_type`.
