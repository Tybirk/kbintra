# 001 — group_type classification spine

**Type:** AFK

## Parent

docs/grafisk-overblik-plan.md

## What to build

Replace the `is_committee` boolean on `Subgroup` with a single typed `group_type`
classification used across the whole stack. Every subgroup becomes one of
`generalforsamling | faellesmoede | bestyrelse | udvalg | arbejdsgruppe | almindelig`
(default `almindelig`). Existing committees migrate to `udvalg` and the "Bestyrelsen"
group to `bestyrelse`. The forum overview's "Udvalg" section is now driven by
`group_type` instead of the dropped boolean.

End state: `/forum` looks and behaves exactly as today, but classification lives in one
typed field, and Django admin lets an admin pick a group's type. This is the spine every
later slice builds on.

## Acceptance criteria

- [ ] `Subgroup.group_type` exists — `TextChoices` with the six values above, default `almindelig`, `db_index=True`; `is_committee` removed. `Meta.ordering` no longer references `is_committee`.
- [ ] Data migration maps `is_committee=True → udvalg` and the "Bestyrelsen" group → `bestyrelse` (fuzzy name match per the `0041` pattern), with a working reverse.
- [ ] `SubgroupSerializer` exposes `group_type` and no longer exposes `is_committee`.
- [ ] `ForumPage.tsx` "Udvalg" section is driven by `group_type === "udvalg"`.
- [ ] Frontend `Subgroup` type gains `group_type` and drops `is_committee`; `GroupType` union added.
- [ ] All `is_committee` references migrated: `conftest.py:280`, `tests.py` (49-50, 626, 1671), `seed_forum_subgroups.py` (143/166/190), `ForumPage.test.tsx`, `SubgroupPage.test.tsx`.
- [ ] Django admin shows `group_type` as an editable choice on `Subgroup`.
- [ ] Backend: `ruff check`, `ty check`, `pytest` pass. Frontend: `typecheck`, `lint`, `format:check`, `test:run` pass.

## Blocked by

None — can start immediately.

## User stories covered

Foundational — enables 002, 003, and story 7 (excluding almindelige from the overblik).
Delivers the Django-admin half of story 13 (admin can set a group's type).
