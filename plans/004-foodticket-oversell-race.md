# Plan 004: Make FoodTicket creation atomic so portions cannot be oversold

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 023ad2c..HEAD -- backend/apps/food/serializers.py backend/apps/food/tests.py`
> On mismatch with the excerpts below, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (refactor keeps the same validation messages; tests gate behavior)
- **Depends on**: none. Coordinate with plan 005, which also edits `backend/apps/food/serializers.py` — land this one first.
- **Category**: bug
- **Planned at**: commit `023ad2c`, 2026-06-12

## Why this matters

When a household sells surplus meal portions as `FoodTicket`s, the availability check ("you can't sell more portions than your registration") runs in `FoodTicketCreateSerializer.validate()` and the row is inserted later in `create()` — with **no transaction around check + insert**. Two concurrent requests (gunicorn runs 2 workers × 4 threads in production) can both pass validation and both insert, listing more portions than the house registered. Tickets feed the food billing stats, so oversell corrupts billing data. The fix is to re-run the availability check inside a `transaction.atomic()` block together with the insert; the project's SQLite config already uses `transaction_mode: "IMMEDIATE"` (`backend/config/settings.py:139`), which takes the write lock at `BEGIN`, so two atomic blocks serialize fully and the second one sees the first one's committed insert.

## Current state

`backend/apps/food/serializers.py` — `FoodTicketCreateSerializer` (class at line 318):

- `validate()` (≈lines 360-415): after weekday/portion-count checks, it loads the active `MealRegistration` for the user's house+date, aggregates ALL existing tickets for that house+date, computes `available_meat/veg/children`, and raises Danish `ValidationError`s like `"Du kan ikke sælge flere kød-portioner end du har tilgængelige."` if exceeded.

```python
            # Sum of ALL tickets for this date (listed + claimed) to prevent re-listing
            # portions that are already sold. Released tickets are back to is_available=True
            # and will be counted again, which is intentional.
            existing = FoodTicket.objects.filter(house=user.house, date=reg_date).aggregate(
                total_meat=Coalesce(Sum("adults_meat"), 0),
                total_veg=Coalesce(Sum("adults_veg"), 0),
                total_children=Coalesce(Sum("children_count"), 0),
            )
            available_meat = reg.adults_meat - existing["total_meat"]
```

- `create()` (line 416-431): sets `owner`, `house`, default `price`, then `return super().create(validated_data)`. No transaction, no recheck.

```python
    def create(self, validated_data: dict) -> FoodTicket:
        user = self.context["request"].user
        validated_data["owner"] = user
        validated_data["house"] = user.house
        ...
        return super().create(validated_data)
```

Conventions: user-facing validation messages MUST be in Danish (reuse the existing message strings verbatim). Ruff line-length 100. Tests are pytest-django in `backend/apps/food/tests.py` with API-client fixtures from `backend/conftest.py` — find an existing ticket-creation test there with `grep -n "FoodTicket" backend/apps/food/tests.py | head` and model new tests on it.

## Commands you will need

| Purpose | Command (from `/backend`) | Expected on success |
|---|---|---|
| Targeted tests | `uv run pytest apps/food/tests.py -v -k ticket` | all pass |
| Full suite | `uv run pytest` | all pass |
| Lint/format | `uv run ruff check --fix . && uv run ruff format .` | exit 0 |
| Typecheck | `uvx ty check` | exit 0 |

## Scope

**In scope**: `backend/apps/food/serializers.py` (only `FoodTicketCreateSerializer`), `backend/apps/food/tests.py`.

**Out of scope**:

- `ClaimFoodTicketView` / ticket claiming (`backend/apps/food/views.py:~616`) — a different flow; do not touch.
- `MealRegistrationSerializer.get_available_portions` — plan 005 changes it; leave it alone.
- The API response shape and the Danish error messages — must stay byte-identical (the frontend matches on them).
- Any model/migration change.

## Git workflow

- Branch: `advisor/004-foodticket-oversell-race`
- One commit, e.g. `fix: atomic availability check on food ticket creation`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Extract the availability check into a helper

In `FoodTicketCreateSerializer`, extract the registration-lookup + aggregate + three `ValidationError` checks from `validate()` into a private method:

```python
    def _check_availability(
        self, user, reg_date, adults_meat: int, adults_veg: int, children_count: int
    ) -> None:
        """Raise ValidationError if the house lacks unsold portions. Must be
        called inside transaction.atomic() when used to gate an insert —
        SQLite's IMMEDIATE transactions serialize concurrent writers."""
```

`validate()` calls it exactly where the old code was (same pre-flight errors, same messages — keep the `user.house_id` and "aktiv tilmelding" checks in whichever place they currently are, just don't change behavior).

**Verify**: `uv run pytest apps/food/tests.py -v -k ticket` → all existing tests pass.

### Step 2: Re-check inside an atomic block in create()

Change `create()` to:

```python
    def create(self, validated_data: dict) -> FoodTicket:
        user = self.context["request"].user
        validated_data["owner"] = user
        validated_data["house"] = user.house
        ...price defaulting unchanged...

        with transaction.atomic():
            # Re-validate inside the write transaction: BEGIN IMMEDIATE
            # serializes writers, so this sees all committed tickets and
            # closes the validate()->create() race window.
            self._check_availability(
                user,
                validated_data["date"],
                validated_data.get("adults_meat", 0),
                validated_data.get("adults_veg", 0),
                validated_data.get("children_count", 0),
            )
            return super().create(validated_data)
```

Import `transaction` from `django.db` at the top of the file (check it isn't already imported).

**Verify**: `uv run pytest apps/food/tests.py -v -k ticket` → all pass; `uv run ruff check . && uvx ty check` → exit 0.

## Test plan

Add to `backend/apps/food/tests.py` (model on the existing ticket-creation API tests):

1. **Regression (the race, simulated)**: create a registration with `adults_veg=2`; create one ticket for 2 veg portions via the ORM directly (bypassing the serializer's `validate()`, simulating a concurrent insert that landed after validation); then instantiate `FoodTicketCreateSerializer` with already-validated data and call `.save()` → expect `ValidationError` from the in-transaction recheck. (This tests the `create()`-side check specifically, which the old code lacked.)
2. **Happy path unchanged**: API POST for a sellable ticket within availability → 201, same response shape as before.
3. **Pre-flight error unchanged**: API POST exceeding availability → 400 with the exact Danish message `"Du kan ikke sælge flere kød-portioner end du har tilgængelige."` (or the veg/children variant used).

Verification: `uv run pytest apps/food/tests.py -v` → all pass including 3 new tests; `uv run pytest` → full suite green.

## Done criteria

- [ ] `uv run pytest` exits 0 with 3 new tests
- [ ] `uv run ruff check .`, `uv run ruff format --check .`, `uvx ty check` exit 0
- [ ] `grep -n "transaction.atomic" backend/apps/food/serializers.py` → ≥1 hit inside `FoodTicketCreateSerializer.create`
- [ ] Danish error messages unchanged (`git diff` shows no string edits)
- [ ] No files outside scope modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `validate()` or `create()` no longer match the excerpts (drift).
- The availability check in `validate()` turns out to depend on serializer state not available in `create()` (e.g. `self.instance` on updates) — report rather than guess.
- Any existing food test fails after Step 1 (the extraction changed behavior).

## Maintenance notes

- The same check-then-act pattern exists in other food flows (e.g. claiming tickets). If overselling reports continue, audit `ClaimFoodTicketView` next — deliberately out of scope here.
- If the DB ever moves off SQLite (or `transaction_mode` changes), the serialization guarantee changes: on PostgreSQL this code would need `select_for_update()` on the registration row instead. The comment in Step 2 records this.
- Reviewer: confirm the recheck reads `validated_data` (post-validation values), not raw request data.
