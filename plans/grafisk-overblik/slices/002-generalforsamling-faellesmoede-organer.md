# 002 — Generalforsamling + Fællesmøde organer, all users subscribed

**Type:** AFK

## Parent

docs/grafisk-overblik-plan.md

## What to build

Create the two top organer that don't yet exist — **Generalforsamling** and
**Fællesmøde** — as forum groups with the right `group_type`, marked as default groups,
and subscribe every existing user to them. `is_default` only auto-subscribes *future*
users, so the ~90 current residents must be backfilled (same approach as migration
`0041`).

End state: every resident sees Generalforsamling and Fællesmøde under "Grupper du
abonnerer på" in `/forum` and is notified of activity in foreningens two øverste organer.

## Acceptance criteria

- [ ] Data migration creates "Generalforsamling" (`group_type=generalforsamling`) and "Fællesmøde" (`group_type=faellesmoede`) if they don't already exist, both `is_default=True` with a sensible icon.
- [ ] All current users are backfilled with a `SubgroupSubscription` to both groups — idempotent, fuzzy-name-safe, and a harmless no-op on an empty/CI database (mirror `0041`).
- [ ] New users continue to be auto-subscribed via the existing `is_default` mechanism.
- [ ] An existing user's `/forum` shows both groups in the subscribed section.
- [ ] Backend `pytest` passes, including a test asserting both groups exist and a sample user is subscribed to each.

## Blocked by

- plans/grafisk-overblik/slices/001-group-type-spine.md

This slice adds a `forum` data migration, so it's part of the linear migration chain with
003/004 — land it in numeric order (001 → 002 → 003 → 004) to avoid conflicting leaf
migrations. See `plans/grafisk-overblik/README.md` ("Landing order & the forum migration
chain").

## User stories covered

17 — all residents auto-subscribed to Generalforsamlingen and Fællesmødet.
