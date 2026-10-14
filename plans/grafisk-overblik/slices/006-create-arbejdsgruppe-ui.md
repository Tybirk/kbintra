# 006 — Create arbejdsgruppe/almindelig from the UI

**Type:** AFK

## Parent

docs/grafisk-overblik-plan.md

## What to build

Let any resident create an **arbejdsgruppe** or an **almindelig gruppe** from the UI,
choosing the type and — for arbejdsgrupper — the parent organ/arbejdsgruppe plus optional
dates. Because a node *is* its forum group, creating an arbejdsgruppe under an organ
immediately shows it in the overblik. Organ types (Generalforsamling/Fællesmøde/
Bestyrelse/Udvalg) remain admin-only.

End state: the board's "når der oprettes en arbejdsgruppe i oversigten, oprettes
forumgruppen automatisk" — satisfied by construction.

## Acceptance criteria

- [ ] `SubgroupCreateSerializer`/`SubgroupListView.create` accept `group_type` (non-staff restricted to `arbejdsgruppe`/`almindelig`; organ types rejected for non-staff), `parent`, `established_on`, `expires_on`, with parent-type/cycle validation reused from slice 003.
- [ ] The create modal (in `ForumPage.tsx` and an "Opret arbejdsgruppe" button on `/overblik`) has a type selector; when "Arbejdsgruppe" is chosen it shows a parent `Select` (organer + arbejdsgrupper) and date inputs; the "Almindelig gruppe" path is unchanged from today.
- [ ] A newly created arbejdsgruppe appears under its parent in `/overblik`; a newly created almindelig gruppe appears only in `/forum`.
- [ ] Tests: a non-staff user can create an arbejdsgruppe/almindelig but not an organ; an arbejdsgruppe requires a valid parent; the created arbejdsgruppe surfaces in `/overblik`.
- [ ] All required backend + frontend checks pass.

## Blocked by

- plans/grafisk-overblik/slices/003-parent-children-hierarchy.md
- plans/grafisk-overblik/slices/004-lifecycle-metadata-archiving.md
- plans/grafisk-overblik/slices/005-overblik-page-and-endpoint.md

## User stories covered

8, 9, 10, 15.
