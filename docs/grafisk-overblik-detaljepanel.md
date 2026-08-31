# Implementation plan: Grafisk overblik → Mandatlinjer + Detaljepanel

**Status:** built · **Branch:** `docs/overblik-detaljepanel-plan` (off `feature/grafisk-overblik`)

> Implemented as specified, with three deviations, all noted inline below:
> §7 drops the `Rediger` action, §10 splits the "not in tree" message in two, and the file list gained
> `utils/groupType.ts` plus three test files. Kept as the record of *why*, not as a to-do list.

**Supersedes** the "Grafisk overblik" UI section of `docs/grafisk-overblik-plan.md`. The data model,
migrations, backend endpoints and the create/edit flows described there are already built and stay as they are —
this plan only replaces the *presentation* of `/overblik`.

Design reference (live prototypes, both viewports):
<https://claude.ai/code/artifact/45fdcaba-062d-49fe-a0ca-c0a22b0ac63c> — build the **"Detaljepanel"** variant.

> Language note: this document is English (like `docs/architecture.md`). Every user-facing string it
> quotes is Danish and must be used **verbatim** — the app is Danish-only.

---

## 1. The decision

`/overblik` becomes **one view, always**: a vertical indented tree ("mandatlinjer") where every row is a group
and indentation is one mandate step. Tapping a row opens that group's details **without leaving the page** —
a bottom drawer on mobile, a docked side panel on desktop. Opening the group's forum page becomes the *next*
step, not the only step.

Two prior views are deleted: the horizontal org chart and the Mantine `Tree` view.

**Why:** the org chart renders 11 sibling roots at a fixed 220 px each — roughly 3 500 px wide, seven phone
screens of horizontal scrolling — and it put each group's purpose in a `Tooltip`, which never opens on touch.
A vertical tree costs 18 px per depth level instead of a screen width, and the panel gives the purpose,
dates and members a real place to live.

---

## 2. What gets deleted

| File | Action |
| --- | --- |
| `frontend/src/components/OrgChart.tsx` | delete |
| `frontend/src/components/OrgChart.css` | delete |
| `OverviewPage`: `viewMode` state, `SegmentedControl`, `Tree`/`useTree`/`getTreeExpandedState`, `OrgNodeCard`, `buildTreeData`, the expand-all `useEffect` | delete |

Nothing else imports `OrgChart` — check with `grep -rn "OrgChart" frontend/src` before removing.

Keep as-is: the "Vis afsluttede arbejdsgrupper" `Switch`, the "Opret arbejdsgruppe" button, and
`CreateSubgroupModal`.

---

## 3. Desktop layout

This is the part that needed a real decision, because the naive version (two independently scrolling columns)
reintroduces on desktop exactly the nested-scroll problem we are removing from mobile.

**Rule: the page keeps exactly one scroll container — the document.** Do not give the tree its own
`overflow-y`. KB Intra runs inside a Mantine `AppShell` whose `<main>` is the scroller; a second scroller
inside it fights the shell and breaks iPadOS/Safari momentum scrolling.

```
┌─ AppShell.Main ─────────────────────────────────────────────┐
│  Grafisk overblik            [Vis afsluttede] [Opret …]     │
│  ┌──────────────────────────────┐  ┌──────────────────────┐ │
│  │ Generalforsamling            │  │  ▓ position: sticky  │ │
│  │ Fællesmøde                   │  │                      │ │
│  │ Bestyrelsen                  │  │  Bivenner            │ │
│  │ └─ Vedtægtsgruppen           │  │  Mandat fra          │ │
│  │ Driftsudvalget          ◄────┼──┤  Grønt udvalg        │ │
│  │ ├─ Legepladsgruppen          │  │                      │ │
│  │ └─ Malergruppen              │  │  Formål…             │ │
│  │ Grønt udvalg                 │  │  Oprettet · Udløber  │ │
│  │ ├─ Bivenner        ← valgt   │  │  Medlemmer …         │ │
│  │ │  └─ Honninggruppen         │  │                      │ │
│  │ └─ Frugtlunden               │  │  [Åbn forumgruppen]  │ │
│  │ …                            │  └──────────────────────┘ │
│  └──────────────────────────────┘   panel follows the scroll │
└─────────────────────────────────────────────────────────────┘
```

**Grid.** At `md` and up (`@media (min-width: 62em)`):

```css
.layout { display: grid; gap: var(--mantine-spacing-md); }
@media (min-width: 62em) {
  .layout { grid-template-columns: minmax(0, 1fr) 360px; align-items: start; }
}
```

`minmax(0, 1fr)` on the first column, not `1fr` — without the `0` minimum, a long group name refuses to
ellipsis and blows the grid out.

**Sticky panel.** The panel is sticky inside normal document flow, so the tree scrolls past it:

```css
.panel {
  position: sticky;
  top: calc(var(--app-shell-header-height, 60px)
          + var(--test-banner-height, 0px)
          + var(--mantine-spacing-md));
  max-height: calc(100dvh - var(--app-shell-header-height, 60px)
                          - var(--test-banner-height, 0px)
                          - var(--mantine-spacing-md) * 2);
  overflow-y: auto;
}
```

`--test-banner-height` is mandatory. It is set by `TestDomainBanner` and is non-zero on kbintra.top; omit it
and the panel sticks *underneath* the staging banner. See `App.tsx:264` for the same calculation.

The `max-height` + `overflow-y` pair only engages for groups with long member lists — the panel is a
bounded sidebar, not the main reading surface, so a scrollbar there is acceptable where one in the tree is not.

**Desktop always has a selection.** An empty 360 px column reads as a broken page. When no slug is in the URL,
derive the selection as the first root (Generalforsamling) **without redirecting** — do not `navigate()` on
mount. A redirect would add a history entry on every visit and make the back button useless. The URL changes
only when the user actually picks a group.

**Below `md`** the grid collapses to one column, the panel is not rendered inline at all, and selection opens
a `Drawer` instead (§4).

---

## 4. Mobile layout

Single column. Selecting a row opens a Mantine `Drawer`:

```tsx
<Drawer
  opened={!!selectedSlug}
  onClose={() => navigate("/overblik", { replace: true })}
  position="bottom"
  size="80%"
  radius="lg"
  title={null}                    // the panel renders its own heading
  withCloseButton
  closeButtonProps={{ "aria-label": "Luk" }}
/>
```

Use Mantine's `Drawer` rather than a hand-rolled sheet: it brings the focus trap, `Escape` handling, the
overlay and body scroll lock, all of which we would otherwise have to get right by hand.

`size="80%"` deliberately leaves the top of the tree visible — the honest weakness of this direction is that
the drawer hides structure, and leaving a strip visible softens it.

**Nothing is selected on mobile load.** Auto-selecting would cover the tree with a drawer before the user has
done anything.

---

## 5. Data flow — no backend changes

The single most important finding: **the panel does not need a new endpoint or a new field.**

| Data | Source |
| --- | --- |
| The tree, mandate structure, member avatars, dates, `is_active` | `GET /api/forum/organisation/` (existing, `OrgNodeSerializer`) |
| Panel detail: `thread_count`, `latest_thread_title`, `latest_thread_activity_at`, `unread_thread_count`, `is_subscribed`, `icon`, `allows_members` | `GET /api/forum/subgroups/<slug>/` (existing, `SubgroupSerializer`) |

`SubgroupDetailView` already builds the full serializer context (`member_subgroup_ids`, `read_status_map`,
`subscribed_subgroup_ids`), and `SubgroupSerializer._thread_stats` already skips closed threads and
`members_only` threads the viewer may not see. **Fetching the panel's rich fields through this endpoint gets
per-viewer visibility correct for free.**

> ⚠️ Do **not** add `latest_thread_title` to `OrgNodeSerializer`. `OrganisationView` builds plain dicts with no
> thread prefetch and no viewer context; a naive `subgroup.threads.last().title` there would leak the title of
> a members-only thread to every resident. The two-query split above exists precisely to avoid that.

Queries:

```ts
// tree — unchanged
useQuery({
  queryKey: ["forum", "organisation", includeInactive],
  queryFn: () => forumApi.getOrganisation(includeInactive),
})

// panel — existing client function, already in frontend/src/api/forum.ts
useQuery({
  queryKey: ["forum", "subgroup", slug],
  queryFn: () => forumApi.getSubgroup(slug!),
  enabled: !!slug,
})
```

The panel renders immediately from the `OrgNode` already in the tree (name, type, description, dates,
member avatars) and fills in thread counts when the second query resolves. **No spinner on selection** — the
panel must never flash empty, because on desktop it is always on screen.

---

## 6. Routing

Add a second route; the page component is the same.

```tsx
// frontend/src/App.tsx — beside the existing /overblik route (~line 469)
<Route path="/overblik/:slug" element={<ProtectedRoute><ErrorBoundary><OverviewPage /></ErrorBoundary></ProtectedRoute>} />
```

Selection lives in the URL, not in state. This buys four things for one `useParams()`:

1. A group's overview entry is linkable — "se Bivenner her".
2. Android hardware back and iOS edge-swipe close the drawer, because closing *is* going back.
3. A refresh keeps the selection.
4. Slugs in URLs, per `CLAUDE.md`.

Rows are `<Link to={`/overblik/${node.slug}`}>`, not buttons — that gives middle-click, cmd-click and
"open in new tab" for free. Closing the drawer navigates to `/overblik` with `replace: true` so repeated
open/close does not stack history entries.

---

## 7. Components

### `OverviewPage.tsx` (rewritten)

Owns: `includeInactive` state, `collapsed: Set<number>` state, the two queries, the media query, the grid,
and the drawer-vs-inline decision.

```tsx
const isDesktop = useMediaQuery("(min-width: 62em)")   // matches AnnouncementsPage's convention
```

`useMediaQuery` returns `undefined` on first render. Treat `undefined` as mobile (`isDesktop === true` is the
only desktop condition) so the drawer never flashes open on a phone.

### `OrgTree.tsx` (new)

```tsx
interface OrgTreeProps {
  nodes: OrgNode[]
  selectedSlug: string | null
  collapsed: Set<number>
  onToggleCollapse: (id: number) => void
}
```

Renders a flat `<ul role="list">` of rows — see §8 for geometry. Each row:

```
[± fold button]  [type dot]  Gruppenavn  [Afsluttet]  ·····  [avatars] [antal]
└─ own <button>  └────────────── the <Link> ─────────────────────────────────┘
```

Two hit targets, never nested: the fold `<button>` is a **sibling** of the `<Link>`, both children of the row
`<li>`. Nesting a button inside a link is invalid HTML and breaks keyboard activation.

### `OrgDetailPanel.tsx` (new)

```tsx
interface OrgDetailPanelProps {
  node: OrgNode              // from the tree, renders instantly
  detail?: Subgroup          // from getSubgroup, fills in thread counts
  mandatePath: OrgNode[]     // ancestors, root-first
}
```

Contents, in order:

1. Type badge (`Udvalg` / `Arbejdsgruppe` / …) + `Afsluttet` badge when `is_active === false`
2. Group name, `<Title order={3}>`
3. Mandate line — `Mandat fra Grønt udvalg › Bivenner`, omitted for roots
4. Purpose — `description` is Tiptap HTML, not plain text. Render it with
   `<RichTextContent className="description-content" html={node.description} />`
   (named export from `../components/RichTextContent`, same call shape as `SubgroupPage.tsx:1243`).
5. Facts row — `Oprettet`, `Udløber`, `Medlemmer`, `Tråde`
6. Member chips — avatar + full name, from `node.members`, then `+N flere` when `member_count` exceeds them
7. Latest activity — `Seneste tråd` + relative time, **only when `detail` has loaded and is non-null**
8. Actions — `Åbn forumgruppen` (primary, `<Link to={`/forum/${slug}`}>`)

> **Deviation, as built:** the planned `Rediger` action was dropped. Editing a group lives on
> `SubgroupPage`, and there is no deep link to its edit affordance — so the button would have gone to the
> same place as `Åbn forumgruppen`, one row above it. Two buttons to one destination is noise. Add it back
> only alongside a real `?rediger` deep link.

### `utils/orgTree.ts` (extend the existing file)

```ts
export function findNodeBySlug(nodes: OrgNode[], slug: string): OrgNode | null
export function mandatePath(nodes: OrgNode[], slug: string): OrgNode[]   // ancestors, root-first, excl. self
export function flattenForDisplay(nodes: OrgNode[], collapsed: Set<number>): OrgRow[]
```

Keep the existing `flattenOrgTree` — `CreateSubgroupModal` and `SubgroupPage` use it for the parent `Select`.

---

## 8. Rail geometry

The indent guides are the fiddly part. This spec is authoritative; the prototype is the reference for
*layout and content*, not for exact rail coordinates.

```
PAD = 14        // px, left padding of a depth-0 row
STEP = 18       // px per depth level
INSET = 7       // px, where the guide sits inside the parent's indent slot
ROW_H = 44      // px minimum row height (touch target)

contentX(depth) = PAD + depth * STEP           // row's padding-left
lineX(level)    = PAD + (level - 1) * STEP + INSET   // only defined for level >= 1
```

`flattenForDisplay` emits one row per visible node:

```ts
interface OrgRow {
  node: OrgNode
  depth: number
  isLast: boolean               // last among its siblings
  ancestorHasNext: boolean[]    // index k → "ancestor at depth k+1 has a later sibling"
}
```

Built by walking the tree; when recursing from a node into its children:

```ts
const nextGuides = depth === 0 ? [] : [...guides, !isLast]
```

Roots contribute nothing — depth-0 rows never draw a connector, so `ancestorHasNext.length === depth - 1`
for every row at depth ≥ 1.

Per row, absolutely positioned inside a `position: relative` `<li>`:

- **Ancestor guides** — for each `k` where `ancestorHasNext[k]` is true, a 1 px full-height vertical line at
  `lineX(k + 1)`.
- **Elbow** — when `depth >= 1`, at `lineX(depth)`: an 11 px wide, `ROW_H / 2` tall box with
  `border-left` + `border-bottom` and `border-bottom-left-radius: 4px`.
- **Own continuation** — when `depth >= 1 && !isLast`, a 1 px vertical line at `lineX(depth)` spanning the
  full row height, so the line reaches the next sibling.

Worked example — **Honninggruppen** (Grønt udvalg › Bivenner › Honninggruppen), `depth = 2`, only child so
`isLast = true`, and Bivenner has a later sibling (Frugtlunden) so `ancestorHasNext = [true]`:

- content at `contentX(2)` = 50 px
- full-height guide at `lineX(1)` = 21 px  ← Bivenner's line continuing down to Frugtlunden
- elbow at `lineX(2)` = 39 px
- no own continuation (it is the last child)

Colour every line with the row's own group-type colour at ~30 % alpha
(`color-mix(in srgb, <type colour> 30%, transparent)`) so the rails stay legible in both themes without a
second palette.

Put this in a plain `OrgTree.css` scoped under a single root class — the same pattern the deleted
`OrgChart.css` used. The project has no CSS-modules setup; do not introduce one for this.

---

## 9. Accessibility

- **Do not build an ARIA `tree` widget.** A real `role="tree"` owes the user arrow-key navigation, typeahead
  and roving tabindex. Use a plain `<ul role="list">` of links: robust, and the structure is already conveyed
  by the indentation and the mandate line in the panel. Resist "upgrading" this.
- Fold button: `aria-expanded={!collapsed}` and `aria-label={collapsed ? \`Fold ${name} ud\` : \`Fold ${name} sammen\`}`.
- Selected row link: `aria-current="true"`.
- **Touch target.** The fold glyph is visually ~19 px. Expand its hit area into the left gutter, where only
  decorative rails live — never to the right, or it steals taps meant for the group name:
  ```css
  .foldBtn { position: relative; }
  .foldBtn::after { content: ""; position: absolute; inset: -12px -4px -12px -14px; }
  ```
  Rows are `min-height: 44px`.
- The `Drawer` handles focus trap, `Escape` and scroll lock. On desktop, do **not** move focus on selection —
  focus stays on the activated link, which is correct for navigation. Give the panel
  `aria-labelledby` pointing at its own heading.
- Respect `prefers-reduced-motion` on the fold chevron rotation.

---

## 10. Edge cases

1. **Selected slug not in the visible tree.** Happens when the URL names an archived group and
   "Vis afsluttede" is off. The panel still renders — it fetches by slug and the detail endpoint does not
   filter on `is_active`. Do not auto-flip the switch. Show, above the panel body:
   `Denne gruppe er afsluttet. Slå »Vis afsluttede arbejdsgrupper« til for at se den i træet.`

   > **Deviation, as built:** archived is not the only way to be missing from the tree. The organisation
   > endpoint only returns organs and arbejdsgrupper, so an *almindelig* group reached by URL is absent
   > while being perfectly active — and the message above would have called it archived. The panel now
   > picks by `is_active`, and an active group missing from the tree gets
   > `Denne gruppe er ikke en del af foreningens organisation.` instead.
2. **Unknown slug** (deleted or typo). `getSubgroup` 404s → render
   `Gruppen findes ikke længere.` with a link back to `/overblik`. Do not throw to `ErrorBoundary`.
3. **Empty organisation** (`data.length === 0`). Keep today's copy:
   `Der er endnu ikke nogen organisationsstruktur.` No panel column.
4. **Collapsing an ancestor of the selection.** Leave the selection alone — the panel stays open and correct
   even though the row is no longer visible. Do not clear the URL.
5. **Toggling "Vis afsluttede" off while an archived group is selected.** Same as case 1.
6. **Group with a very long name.** The row link needs `min-width: 0` and `text-overflow: ellipsis`; the panel
   heading wraps rather than truncates.

---

## 11. Tests

`frontend/src/pages/OverviewPage.test.tsx` currently has four tests, three of which assert the deleted views
(`defaults to the org chart view…`, `switches to the tree view and back via the segmented control`). Replace with:

1. renders every organ and nested arbejdsgruppe name from the mocked tree
2. clicking a row navigates to `/overblik/<slug>` and the panel shows that group's name and purpose
3. the panel's `Åbn forumgruppen` link points at `/forum/<slug>`
4. `/overblik/bivenner` on first load renders the panel for Bivenner (deep-link works)
5. the fold button hides that group's children and does not change the selection
6. toggling the switch refetches with `include_inactive=true` (keep the existing assertion)
7. an unknown slug renders `Gruppen findes ikke længere.` rather than crashing
8. empty organisation renders `Der er endnu ikke nogen organisationsstruktur.` (keep)

Mock `forumApi.getOrganisation` **and** `forumApi.getSubgroup`. Render inside a `MemoryRouter` with
`initialEntries` so the `:slug` route resolves; the existing test file's render helper needs the extra route
registered.

Note for whoever writes these: Mantine 9.5 renders a `searchable` `<Select>` with `role="combobox"`, not
`role="textbox"` — this bit `CreateSubgroupModal.test.tsx` during the main merge.

No backend tests change. `backend/apps/forum/tests.py` already covers `/api/forum/organisation/`
ordering, pruning of archived subtrees and the parent/children hierarchy.

---

## 12. Files touched

```
frontend/src/pages/OverviewPage.tsx          rewrite
frontend/src/pages/OverviewPage.test.tsx     rewrite
frontend/src/pages/OverviewPage.css          new    — grid + sticky panel
frontend/src/components/OrgTree.tsx          new
frontend/src/components/OrgTree.css          new
frontend/src/components/OrgTree.test.tsx     new    — rail geometry
frontend/src/components/OrgDetailPanel.tsx   new
frontend/src/components/OrgChart.tsx         delete
frontend/src/components/OrgChart.css         delete
frontend/src/utils/orgTree.ts                extend
frontend/src/utils/orgTree.test.ts           new    — flatten/mandate helpers
frontend/src/utils/groupType.ts              new    — shared labels + palette
frontend/src/App.tsx                         add /overblik/:slug route
```

Two files beyond the plan's list, both to avoid duplication: `groupType.ts` holds the Danish labels and
palette that the tree and the panel both need (they were inlined in the deleted `OrgChart.tsx`, and having
one component import them from the other would have been the wrong dependency), and `OverviewPage.css`
keeps the grid in a real media query so the layout is correct on the first paint rather than after
`useMediaQuery` settles.

Backend: **no changes.** No migration, no serializer change, no new endpoint.

---

## 13. Out of scope

- Adding thread data to `OrgNodeSerializer` (see the warning in §5).
- Persisting the collapsed set across visits — 24 groups do not need it, and `localStorage` state that
  silently hides groups is a support burden.
- Search inside the overview. Global search (`GlobalSearch.tsx`) already finds groups.
- Drag-to-reparent. Changing a group's parent stays in the edit form on `SubgroupPage`.
- Any change to `/forum`, `SubgroupPage` or the create/edit flows.

---

## 14. Definition of done

Default the collapsed set to **empty** — every group visible on load. The fold control is there for tidying,
not for hiding things on first paint.

```bash
cd frontend
npm run typecheck && npm run lint && npm run format:check && npm run test:run
```

Then check by hand at 390 px and at 1280 px:

- [ ] no horizontal scrollbar at 390 px, at any fold state
- [ ] desktop: the panel stays in view while the tree scrolls past it, and does not slide under the header
- [ ] on kbintra.top (staging banner visible) the panel still clears the header — this is the
      `--test-banner-height` case and it is easy to get wrong
- [ ] mobile: browser back closes the drawer instead of leaving the page
- [ ] `/overblik/bivenner` pasted into a fresh tab opens with Bivenner selected
- [ ] the depth-3 branch (Grønt udvalg › Bivenner › Honninggruppen) draws correct rails per §8
- [ ] `Vis afsluttede` reveals Vedtægtsgruppen under Bestyrelsen
- [ ] both light and dark themes
