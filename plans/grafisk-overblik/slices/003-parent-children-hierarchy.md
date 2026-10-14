# 003 — Parent/children hierarchy

**Type:** AFK

## Parent

docs/grafisk-overblik-plan.md

## What to build

Give subgroups a **soft** parent/child relationship so an arbejdsgruppe can sit under an
organ — or under another arbejdsgruppe, to arbitrary depth. The relation works
end-to-end: validation prevents cycles and illegal parent types; the subgroup page shows
a "← forælder" breadcrumb plus a children section; the parent is editable via the API and
Django admin.

The relationship is **navigation/structure only — not a visibility or permission
cascade** (carried over from `bugs/11-subgroup-hierarchy.md`). Privacy stays per-group via
the existing `allows_members`/`members_only` mechanics.

## Acceptance criteria

- [ ] `Subgroup.parent` self-FK (`on_delete=SET_NULL`, `related_name="children"`).
- [ ] `clean()`/`save()` rejects cycles (walk ancestors with a depth cap) and illegal parent types: `almindelig` must have no parent; `arbejdsgruppe` parent must be an organ or another `arbejdsgruppe`; organ types have no parent.
- [ ] `SubgroupSerializer` exposes `parent`, `parent_name`, `parent_slug`, and lightweight `children` (`id`/`name`/`slug`).
- [ ] `SubgroupUpdateSerializer`/`SubgroupUpdateView` accept `parent`. The view becomes **type-aware**:
  - For an **arbejdsgruppe**: structural edits (`parent`, dates) and `description` are allowed for any authenticated user (no leader concept).
  - For an **organ** (`generalforsamling`/`faellesmoede`/`bestyrelse`/`udvalg`): editing structural fields, `name`, `description`, and `icon` requires `is_staff` **or** membership of that organ. Note this **tightens** today's behavior — `name`/`description`/`icon` are currently editable by anyone (only `links_info`/`links_info_members`/`allows_members` are gated in `patch`), so this is net-new gating that must be added for organ types only.
  - `group_type` reclassification stays staff/admin-only (out of scope for this view; happens in Django admin).
- [ ] `SubgroupPage.tsx` shows a parent breadcrumb chip (links to parent) and a children/"Arbejdsgrupper" chip section.
- [ ] Django admin supports setting `parent` (autocomplete or raw_id).
- [ ] Tests: cycle rejected; parent-type rules enforced; ≥2-level nesting accepted; chips render; an organ's `name`/`description` is editable by a member or staff but rejected (403) for a non-member non-staff user, while an arbejdsgruppe's structural edits succeed for any authenticated user.
- [ ] All required backend + frontend checks pass.

## Blocked by

- plans/grafisk-overblik/slices/001-group-type-spine.md

Land **before** 004: both add columns to `Subgroup`, so they must land sequentially —
two branches running `makemigrations forum` off 001 would produce conflicting leaf
migrations. 004 builds its lifecycle migration on top of this slice's `parent` migration,
and reuses the type-aware permission logic introduced here for its archive action.

## User stories covered

11 (edit a group's parent later); supports 3 and 9. Delivers the Django-admin half of
stories 13/14 (admin reparents/deletes).
