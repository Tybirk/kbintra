# 005 — /overblik page + organisation endpoint

**Type:** AFK

## Parent

docs/grafisk-overblik-plan.md

## What to build

The grafiske overblik itself. A new authenticated endpoint returns foreningens officielle
struktur as an ordered, recursively-nested tree: organ roots in fixed vedtægter order,
arbejdsgrupper nested beneath them, almindelige grupper excluded. A new main-menu entry
**"Grafisk overblik"** opens a page that renders this with Mantine `Tree` — each node
showing formål, medlemmer, datoer, and a link to its forum group — with a switch to
reveal afsluttede arbejdsgrupper.

End state: one place where any resident can see the official structure and which
arbejdsgrupper have a mandate from which organ.

## Acceptance criteria

- [ ] `GET /api/forum/organisation/` returns organ roots ordered Generalforsamling → Fællesmøde → Bestyrelse → Udvalg (alphabetical), each with recursively nested arbejdsgrupper; almindelige grupper excluded; built without N+1 (single flat query, build the nested dict in Python and feed the serializer the finished structure — recursion lives in Python, not the ORM).
- [ ] `?include_inactive=true` includes afsluttede. Default excludes any node that is **itself inactive or has an inactive ancestor** — archiving a parent hides its whole subtree; children are not promoted to roots. This is a display rule only (no cascading `is_active` writes); the archived node's forum group stays reachable by its URL.
- [ ] Navbar gains "Grafisk overblik" → `/overblik`; route registered in `App.tsx`.
- [ ] `OverviewPage.tsx` renders the tree with Mantine `Tree`/`useTree` + a custom `renderNode` (name → forum-group link, formål, member avatars/count, dates, "Afsluttet" badge), foldable and mobile-first.
- [ ] A "Vis afsluttede arbejdsgrupper" `Switch` toggles `include_inactive`.
- [ ] Tests: endpoint root ordering + recursive nesting (≥2 levels) + almindelige excluded; an archived parent hides its whole subtree by default (incl. an *active* child under it) and the full subtree reappears with `include_inactive=true`; page renders the order and the toggle works.
- [ ] All required backend + frontend checks pass.

## Blocked by

- plans/grafisk-overblik/slices/003-parent-children-hierarchy.md
- plans/grafisk-overblik/slices/004-lifecycle-metadata-archiving.md

(002 recommended before demo so the top organer appear, but not strictly blocking.)

## User stories covered

1, 2, 3, 4, 5, 6, 7.
