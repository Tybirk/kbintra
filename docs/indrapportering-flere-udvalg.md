# Indrapportering på flere udvalg — design & implementation plan

Status: implemented 2026-09-13, on `develop`, not yet deployed. Written the same
day; the plan below is what was built, unchanged.

Follows up on two forum threads: "Indrapportering på ny intra" (Intra feature-idéer,
2026-08-25) and "Valg af gruppe til indrapportering" (Intra fejl og mangler,
2026-09-01). The feature itself shipped to `develop` in PR #113 on 2026-08-25 and
runs on TEST; it is not on the real site.

## What Terkild and the thread actually asked for

1. Reporting open on **more than one udvalg** — on TEST he named DU, GU, VU
   (Værkstedsudvalget) and BU, "alle med et driftsansvar".
2. **A short line per udvalg** in the picker, so people understand what belongs
   where: "Grønt Udvalg — Grønne Forslag", "Driftsudvalget — Fejlmelding af inventar".
3. **Open vs. closed queues**: Bestyrelsen closed ("der kan jo være personfølsomme
   sager"), the rest open "så alle kan se hvad allerede er Indrapporteret".
4. Naming settled: **Indrapportering**, not Indberetning (DU's decision).

Two entry points, both already routed:

- `/indrapportering` — the menu item; pick an udvalg in the form.
- `/forum/<slug>/indrapportering` — the udvalg's own tab; the udvalg is implied.

## What already exists

The app was built multi-udvalg from the start, so most of this is switch-flipping:

- `Subgroup.reporting_enabled` (boolean, `list_editable` in admin).
- Case numbers allocated per udvalg via `ReportCounter`, never reused.
- `GET /api/reports/subgroups/` drives the form's "Til:" field; `ReportForm` shows a
  `Select` when more than one udvalg is enabled and hides it when there is one.
- `ReportQueue` takes an optional `subgroupSlug`, so one component serves both entry
  points; cards show the udvalg name only in the unfiltered view.
- Caseworkers = the udvalg's `SubgroupMembership`; xlsx export restricted to them.
- Notifications (`REPORT_NEW`, `REPORT_UPDATE`) with per-user preferences.
- 39 tests in `apps/reports/tests.py`, plus search indexing.

## What is missing

- **Only Driftsudvalget is on**, in the data migration and on TEST.
- **No visibility concept at all.** `report_queryset()` filters on nothing and every
  view is `IsAuthenticated`, so every resident can read every case in every udvalg —
  which is fine today (one open udvalg) and wrong the moment Bestyrelsen is added.
- **No per-udvalg text.** `ReportSubgroupSerializer` returns `id/name/slug`; the
  `Select` renders the name alone.
- **Category labels are DU inventory vocabulary**: "Defekt inventar", "Fejlbehæftet
  inventar", "Forslag til nyt inventar".
- The nav entry is trial-gated (`TRIAL_ONLY_PATHS` in `AppNavbar.tsx`), so on the
  real site the menu entry point does not exist yet.

## Design

### 1. One field with three states, not two booleans

Replace `Subgroup.reporting_enabled: BooleanField` with:

```python
class Reporting(models.TextChoices):
    OFF = "off", "Ingen indrapportering"
    OPEN = "open", "Åben — alle kan læse sagerne"
    CLOSED = "closed", "Lukket — kun udvalget kan læse sagerne"

reporting = models.CharField(max_length=10, choices=Reporting.choices, default=Reporting.OFF)
```

Two booleans (`reporting_enabled` + `reports_members_only`) can express "closed but
off", a state with no meaning that every read site would have to think about. One
field cannot. The feature has never run in production, so the boolean is replaced
outright — no shim, no back-compat property.

`Subgroup.clean()` rejects `reporting != OFF` when `allows_members` is false: the
udvalg's members *are* the caseworkers, so an udvalg without members would accept
cases nobody can work — and, if closed, cases nobody can even read. Admin's
`list_editable` runs model validation, so this is enforced where the flag is flipped.

### 2. One visibility rule, applied in one place

```
OPEN    → every authenticated resident
CLOSED  → the udvalg's members, staff, and the reporter of that individual case
```

The third clause matters: a resident who reports something to Bestyrelsen must be
able to follow their own case, get the notification, and open the link in it.

This mirrors the forum's existing members-only rule exactly — "member of the
subgroup, or you wrote it" (`apps/search/views.py:apply_visibility_filters`), so the
app gains no new access-control concept.

Implementation: `report_queryset(user)` grows the filter, and every view inherits it
because they all start there. `_get_report()` therefore 404s rather than 403s on a
case the viewer may not see, which is right — a 403 would confirm that case #7 in
Bestyrelsen exists.

Search needs the same filter: reports are indexed, and the index deliberately does
not store visibility state, so a `reports` branch is added to
`apply_visibility_filters` alongside threads/posts/files.

### 3. A short line per udvalg

```python
reporting_intro = models.CharField(max_length=120, blank=True, default="")
```

One line, e.g. "Fejlmelding af inventar" or "Grønne forslag og idéer". 120 characters
because it has to survive one line under the udvalg name on a 375 px phone.
`ReportSubgroupSerializer` returns `id, name, slug, reporting_intro, is_closed`.

### 4. The "Til:" picker becomes cards, like the category picker

`ReportForm` already renders "Hvad handler det om?" as a `SimpleGrid` of
`UnstyledButton` cards with icons. The udvalg picker becomes the same thing, which:

- shows `reporting_intro` next to each name without a dropdown having to render
  descriptions,
- gives the form one visual language instead of a `Select` above a card grid,
- is a bigger tap target on mobile, which is where this gets used,
- has room for a lock icon and "Kun udvalget kan se sagen" on closed udvalg — the
  reporter needs to know that *before* writing, not after.

The subgroup-tab entry point keeps passing `subgroupSlug`, so it shows "Til: <navn>"
as today and never renders the picker.

### 5. Categories stay global; the intro text carries the domain

Relabel the three kinds without touching stored values (labels are display-only):

| value | today | becomes |
|---|---|---|
| `defect` | Defekt inventar | Defekt |
| `faulty` | Fejlbehæftet inventar | Virker dårligt |
| `suggestion` | Forslag til nyt inventar | Forslag |

**Rejected: per-udvalg configurable categories.** A `ReportCategory` model would be
the flexible answer and the wrong one — four udvalg and ~90 residents do not need a
config table that someone has to maintain, and every queue filter, sheet column and
notification string would have to stop assuming three kinds. The per-udvalg intro
line does the same job in one field.

Worth a sanity check with Terkild: "Virker dårligt" is the only label that reads
oddly for Grønt Udvalg.

### 6. Which udvalg get switched on

A data migration sets `OPEN` on Driftsudvalget (DU), Grønt udvalg (GU),
Værkstedsudvalget (VU) and Børn- og ungeudvalget (BU), with an intro line each.

Bestyrelsen stays `OFF`. Terkild wants it closed rather than open, and whether it
should exist at all is a fællesmøde decision — but once CLOSED exists, turning it on
is one dropdown in admin, no deploy.

## What was built

1. **Model + migrations** — `Subgroup.Reporting` (off/open/closed) replacing
   `reporting_enabled`, `reporting_intro`, and `Subgroup.clean()`.
   `forum/0051_subgroup_reporting_states` carries the old boolean over
   (`True → open`) and depends on `reports/0003` so that migration still finds
   the column it writes. `reports/0004_open_reporting_for_four_udvalg` opens DU,
   GU, VU and BU with their intro lines; `reports/0005` relabels the kinds.
2. **Visibility** — `services.readable_reports_q(user)` states the rule once;
   `report_queryset(user)` applies it and every view starts there. The `user`
   argument is required, because an optional one that skips the filter is the
   single mistake worth designing out. Hidden cases 404.
3. **Search** — a `reports` branch in `apply_visibility_filters` asks the
   database which ids are readable rather than restating the rule.
4. **API** — `ReportSubgroupSerializer` gained `reporting_intro` and
   `is_closed`; `ReportCreateSerializer` accepts any udvalg that is not off, so
   a closed queue still takes cases from anyone.
5. **Frontend** — the "Til:" picker is a card grid with the intro line and a
   lock, matching the category picker below it; the form warns before anything
   is typed when the queue is closed; `/indrapportering` gained an udvalg
   filter; the subgroup tab keys off `reporting !== "off"` and shows the same
   two facts. `KIND_META` lost its `short` field — with "inventar" gone from the
   labels, the long and short forms were the same string twice.
6. **Tests** — 7 new backend tests (neighbour blocked from list, detail, comment
   and search; udvalg, reporter and staff let through; anyone may file to a
   closed udvalg; `clean()` rejects reporting without members) and 2 new
   frontend tests (picker shows and sends the chosen udvalg; the closed warning
   appears). Backend 1145 passed, frontend 559 passed.
7. **Launch** — `/indrapportering` removed from `TRIAL_ONLY_PATHS`, so the menu
   entry appears for everyone the moment this reaches `main`. `/udlaeg` is
   still gated.

## Still to do

- Deploy TEST and tell Terkild it is ready to check.
- Merge `develop` → `main` when the fællesmøde has had its say. That deploy also
  carries madhold and the bildeling e-mail change.

## Open questions for the fællesmøde

- Should Bestyrelsen have an indrapportering at all, and closed if so?
- Elbil udvalget is not on Terkild's list, but the two live ladestander threads
  (24239, 24240) are exactly this workflow. Ask.
