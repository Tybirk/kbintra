# 007 — Browser QA pass (agent-driven, `claude --chrome`)

**Type:** QA (browser end-to-end; manual-agent-driven, not automated CI)

## Parent

docs/grafisk-overblik-plan.md

## What to do

Drive the *running app in a real browser* and verify every behavior built across slices
001–006 — the things unit/Vitest tests can't see: navbar entry, tree rendering and order,
fold/unfold on mobile width, the "Vis afsluttede" subtree rule, the create-modal type
selector, archive/genåbn round-trips, the organ-edit permission gate, and the
Generalforsamling/Fællesmøde subscriptions. Launched via `claude --chrome`.

The durable output is a new **"Grafisk overblik"** section appended to
`MANUAL_TEST_GUIDE.md` (the repo's stated regression net), plus a one-shot run of that
checklist with pass/fail + notes and a screenshot for every failure.

### Setup / preconditions (do this first, once)

- Dev servers up: `uv run dev.py` (frontend http://localhost:5173, backend daphne :7000).
- Seed structure (build via Django admin for organ types/reparenting — those are
  admin-only — and via the slice-006 UI for arbejdsgrupper). Required fixtures:
  - The two organer **Generalforsamling** + **Fællesmøde** (from slice 002's migration),
    **Bestyrelsen**, and **≥1 Udvalg**.
  - **≥1 arbejdsgruppe** under an organ, and **≥1 grandchild** arbejdsgruppe (≥2 levels).
  - **≥1 archived arbejdsgruppe that still has an *active* child** — this is the only way
    to exercise the subtree-hiding rule from slice 005.
  - **≥1 almindelig gruppe** (to confirm it never appears in `/overblik`).
- Three personas (seed default password `changeme123`, emails like `<name>.<house>@kb.local`):
  **staff/admin**, a **member of an organ** (e.g. Bestyrelsen), and a **non-member**
  regular user.

### Test groups (each a checklist; map to slices/stories)

**A. Navbar + `/overblik` read view** — slices 002, 005; stories 1–7
- [ ] Navbar shows "Grafisk overblik" (sitemap icon) → routes to `/overblik`.
- [ ] Roots in fixed order: Generalforsamling → Fællesmøde → Bestyrelse → Udvalg (alfabetisk).
- [ ] Arbejdsgrupper nested under their organ; the ≥2-level grandchild renders when expanded.
- [ ] Almindelige grupper appear **nowhere** in `/overblik`.
- [ ] Each node: name links to `/forum/<slug>`; shows formål (truncated description),
      member avatars/count, and dates.
- [ ] Fold/unfold a branch works and is usable at a narrow (mobile, ~375px) viewport.
- [ ] "Vis afsluttede arbejdsgrupper" switch is OFF by default → the archived group **and its
      active child** are both hidden. Toggle ON → archived group shows with an "Afsluttet"
      badge and the whole subtree (incl. the active child) reappears.

**B. Top-organ subscriptions** — slice 002; story 17
- [ ] As the regular user, `/forum` shows Generalforsamling and Fællesmøde under
      "Grupper du abonnerer på"; each opens its group page.

**C. Create flows** — slice 006; stories 8, 9, 10, 15
- [ ] Create modal opens from both `/forum` and an "Opret arbejdsgruppe" button on `/overblik`;
      a type selector is present.
- [ ] **Almindelig gruppe**: no parent select, no date inputs; after creating it shows in
      `/forum` but **not** in `/overblik`.
- [ ] **Arbejdsgruppe**: choosing it reveals the parent `Select` (organer + arbejdsgrupper)
      and date inputs; pick a parent organ + dates → create.
- [ ] The new arbejdsgruppe appears under its chosen parent in `/overblik` immediately and
      has a working forum group at `/forum/<slug>`.
- [ ] As the non-staff user, no organ type (Generalforsamling/Fællesmøde/Bestyrelse/Udvalg)
      is offered — only Arbejdsgruppe/Almindelig.

**D. Subgroup page: parent/children chips + dates** — slices 003, 004; stories 5, 11
- [ ] On an arbejdsgruppe page: parent breadcrumb chip "← {parent}" links to the parent; a
      children/"Arbejdsgrupper" chip section lists its sub-groups.
- [ ] `established_on` / `expires_on` are shown.

**E. Archiving round-trip** — slice 004; stories 6, 12, 16
- [ ] "Markér som afsluttet" on an arbejdsgruppe → it leaves the default `/forum` list and
      `/overblik`; its direct URL `/forum/<slug>` still loads.
- [ ] The "vis arkiverede" path on `/forum` reveals it again.
- [ ] "Genåbn" restores it to both lists.

**F. Permission gate** — slices 003, 004; story 13 (app half)
- [ ] As the **non-member non-staff** user: editing an **organ's** name/description is blocked
      (no edit affordance, or a 403/error toast on attempt).
- [ ] As a **member of that organ** (or staff): the same edit succeeds.
- [ ] Any authenticated user can edit / reparent / archive an **arbejdsgruppe**.
- [ ] No app-UI path exists to create or delete an **organ** type (admin-only).

**G. `/forum` "Udvalg" section + regression** — slice 001
- [ ] `/forum` "Udvalg" section lists committees exactly as before (now `group_type`-driven);
      archived groups are not shown by default.
- [ ] Smoke: forum list, opening a thread, and membership still work — the `is_committee`
      removal didn't break grouping or the list.

## Acceptance criteria

- [ ] A "Grafisk overblik" section is added to `MANUAL_TEST_GUIDE.md` containing groups A–G
      as a reusable checklist (Danish UI strings; the guide itself stays English like the rest).
- [ ] The checklist is executed once in the browser; results recorded with pass/fail + a note
      per item and a screenshot attached for each failure.
- [ ] Any defect found is filed (issue or a follow-up note in this slice) — this slice does not
      fix product bugs, it surfaces them.

## How to run it (agent / subagent guidance)

- **One Chrome session cannot be driven by two agents at once.** Run the groups
  **sequentially** in a single browser, or hand off groups A–G to subagents **one at a time**
  (each logs in as the persona it needs, runs its group, writes its report section, then
  yields the browser). Do **not** launch parallel browser-driving agents against the same
  Chrome — they will fight over the page.
- Persona switches (A/B/G as regular user; C/F across non-staff, organ-member, staff) mean
  logging out/in between groups; sequence groups to minimise re-logins.
- A subagent may legitimately run in parallel for **non-browser** prep only (seeding fixtures
  via Django admin/shell, querying the API to confirm backend state) while the primary agent
  drives the page.

## Blocked by

- plans/grafisk-overblik/slices/001-group-type-spine.md
- plans/grafisk-overblik/slices/002-generalforsamling-faellesmoede-organer.md
- plans/grafisk-overblik/slices/003-parent-children-hierarchy.md
- plans/grafisk-overblik/slices/004-lifecycle-metadata-archiving.md
- plans/grafisk-overblik/slices/005-overblik-page-and-endpoint.md
- plans/grafisk-overblik/slices/006-create-arbejdsgruppe-ui.md

This is the final slice — it exercises the whole feature end-to-end in the browser.

## User stories covered

Verification pass over all of them (1–17) as actually rendered, with emphasis on the
behaviors unit tests can't observe: tree order/fold, the subtree-hiding toggle, the create
modal's conditional fields, archive round-trips, and the organ-edit permission gate.
