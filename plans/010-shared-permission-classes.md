# Plan 010: Consolidate the duplicated owner-permission classes (partial — events keeps its own)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 023ad2c..HEAD -- backend/apps/forum/views.py backend/apps/announcements/views.py backend/apps/events/views.py`
> On mismatch with the excerpts below, STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW — permission semantics are pinned by tests before the move
- **Depends on**: plan 001 (creates `backend/apps/common/`; if 001 hasn't landed, create the package yourself as described there: a plain package, NOT a registered Django app)
- **Category**: tech-debt
- **Planned at**: commit `023ad2c`, 2026-06-12

## Why this matters

Three apps define their own `IsOwnerOrReadOnly`. Forum's and announcements' versions express the same idea (owner-only writes) and forum additionally has `IsOwnerOrAdmin`; a permission bug fix must currently be replicated per app. **Important nuance the original audit missed**: the events version is NOT a duplicate — it also gates *reads* of private events — so it stays where it is, renamed for honesty. The deliverable is one shared module for the genuinely shared classes, with the events class explicitly documented as intentionally different.

## Current state

`backend/apps/forum/views.py:73-100`:

```python
class IsOwnerOrReadOnly(permissions.BasePermission):
    """Custom permission to only allow owners to edit/delete."""

    def has_object_permission(self, request: Request, view: Any, obj: Any) -> bool:
        if request.method in permissions.SAFE_METHODS:
            return True
        # Check for author or uploaded_by attribute
        if hasattr(obj, "author"):
            return obj.author == request.user
        if hasattr(obj, "uploaded_by"):
            return obj.uploaded_by == request.user
        return False


class IsOwnerOrAdmin(permissions.BasePermission):
    """Permission to only allow owners or admins to perform action."""

    def has_object_permission(self, request: Request, view: Any, obj: Any) -> bool:
        if request.user.is_staff:
            return True
        if hasattr(obj, "author"):
            return obj.author == request.user
        if hasattr(obj, "uploaded_by"):
            return obj.uploaded_by == request.user
        return False
```

`backend/apps/announcements/views.py:17-23` — same name, simpler body (`SAFE_METHODS` → allow; else `obj.author == request.user`). The forum version's behavior is a strict superset on objects that have `author` (announcements do), so adopting the shared forum-style class does not change announcements' behavior.

`backend/apps/events/views.py:39-48` — same name, DIFFERENT semantics (private events are owner/staff-only for READS too):

```python
class IsOwnerOrReadOnly(permissions.BasePermission):
    """Custom permission to only allow owners to edit/delete.  Private events are owner-only for reads too."""

    def has_object_permission(self, request: Request, view: Any, obj: Event) -> bool:
        if request.method in permissions.SAFE_METHODS:
            if obj.visibility == Event.Visibility.PRIVATE:
                return obj.created_by == request.user or request.user.is_staff
            return True
        return obj.created_by == request.user
```

Conventions: ruff line-length 100; type hints on signatures; pytest-django tests in each app's `tests.py`.

## Commands you will need

| Purpose | Command (from `/backend`) | Expected on success |
|---|---|---|
| Targeted tests | `uv run pytest apps/forum/tests.py apps/announcements/tests.py apps/events/tests.py -q` | all pass |
| Full suite | `uv run pytest` | all pass |
| Lint/typecheck | `uv run ruff check --fix . && uv run ruff format . && uvx ty check` | exit 0 |

## Scope

**In scope**: `backend/apps/common/permissions.py` (create), `backend/apps/common/__init__.py` (create if missing), `backend/apps/forum/views.py`, `backend/apps/announcements/views.py`, `backend/apps/events/views.py` (rename only), tests in those three apps.

**Out of scope**:

- Changing ANY permission behavior. This is a move + rename, byte-equivalent semantics.
- Other permission-ish helpers in forum (`_is_member`, membership gates) — domain-specific, leave them.
- `users`, `food`, `bookings`, `messaging` views — they have their own authorization idioms; consolidating those is not in this plan.

## Git workflow

- Branch: `advisor/010-shared-permission-classes`
- One commit: `refactor: shared IsOwnerOrReadOnly/IsOwnerOrAdmin in apps.common`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Pin current behavior with tests (before moving anything)

Check coverage: `grep -n "IsOwnerOrReadOnly\|403" backend/apps/announcements/tests.py | head`. If the three apps already test "non-owner gets 403 on edit/delete, owner succeeds, reads allowed" paths, note which tests and skip additions. Where missing, add the minimal cases: announcements (non-author PATCH → 403; author PATCH → 200), forum post (same), events (non-owner READ of a PRIVATE event → 404/403 as currently implemented — assert whatever the current API returns, this is a characterization test).

**Verify**: `uv run pytest apps/forum/tests.py apps/announcements/tests.py apps/events/tests.py -q` → green.

### Step 2: Create the shared module

`backend/apps/common/permissions.py` containing forum's two classes verbatim (docstrings updated to mention they check `author` then `uploaded_by`), imports `from rest_framework import permissions` and the `Request`/`Any` typing as in the original.

### Step 3: Switch forum and announcements

- Forum: delete the two classes from `views.py`, add `from apps.common.permissions import IsOwnerOrAdmin, IsOwnerOrReadOnly`.
- Announcements: delete its class, import the shared `IsOwnerOrReadOnly`.

**Verify**: `uv run pytest apps/forum/tests.py apps/announcements/tests.py -q` → green (behavior identical: announcements objects have `author`, so the extra `uploaded_by` branch is dead code there).

### Step 4: Rename the events class in place

Rename events' class to `IsEventOwnerOrReadOnly` (update its usages in `events/views.py` — `grep -n "IsOwnerOrReadOnly" backend/apps/events/views.py`) and extend the docstring: "Intentionally NOT the shared apps.common version: private events are owner/staff-only for reads too."

**Verify**: `uv run pytest apps/events/tests.py -q` → green; `grep -rn "class IsOwnerOrReadOnly" backend/apps` → exactly one hit, in `apps/common/permissions.py`.

## Test plan

Step 1's characterization tests are the safety net; no further new tests. Full suite: `uv run pytest` → green.

## Done criteria

- [ ] `grep -rn "class IsOwnerOrReadOnly\|class IsOwnerOrAdmin" backend/apps --include="*.py"` → only `apps/common/permissions.py` (+ the renamed `IsEventOwnerOrReadOnly` in events)
- [ ] `uv run pytest` exits 0
- [ ] Lint/format/typecheck exit 0
- [ ] `git diff` shows no logic edits inside any permission body — moves and renames only
- [ ] `plans/README.md` status row updated

## STOP conditions

- Announcements' existing tests fail after Step 3 (the "superset" claim was wrong for some object type — report which).
- You find a fourth definition of either class elsewhere (`grep` first) — report; the plan's inventory was wrong.
- `apps.common` import fails because something expects it to be a registered Django app.

## Maintenance notes

- New apps needing owner-only writes should import from `apps.common.permissions`. Worth a line in CLAUDE.md's patterns section next time it's edited.
- Reviewer: the events rename is the only risky hunk — confirm no other module imported events' class by name.
