# Plan 005: Eliminate per-object queries in poll and meal-registration serializers

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 023ad2c..HEAD -- backend/apps/forum/serializers.py backend/apps/food/serializers.py backend/apps/food/views.py`
> On mismatch with the excerpts below, STOP. If plan 004 already landed,
> `food/serializers.py` will have an extracted `_check_availability` helper in
> `FoodTicketCreateSerializer` — that is expected, not drift.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW (read-path only; behavior asserted by tests)
- **Depends on**: land after plan 004 (same file: `backend/apps/food/serializers.py`)
- **Category**: perf
- **Planned at**: commit `023ad2c`, 2026-06-12

## Why this matters

Thread pages are the app's hottest view. `ThreadDetailView` and the post list already prefetch `poll__options__votes__user`, but the poll serializers bypass the prefetch cache: `get_vote_count` calls `obj.votes.count()` (fresh COUNT query), `get_has_voted` calls `obj.votes.filter(...).exists()` (fresh query), and `PollSerializer.get_total_voters` runs a brand-new `PollVote.objects.filter(...)` query — roughly 2 extra queries per option + 1 per poll, on every thread render containing a poll. Separately, the meal-registration week view runs the `FoodTicket` aggregate in `get_available_portions` once per serialized day (4 redundant queries per request). Honest sizing: at ~90 users none of this is an outage, but these are the hot paths, the fix is small, and it removes the patterns most likely to be copy-pasted into the next feature.

## Current state

`backend/apps/forum/serializers.py` (`PollOptionSerializer` at ≈line 360, `PollSerializer` below it):

```python
    def get_vote_count(self, obj: PollOption) -> int:
        return obj.votes.count()

    def get_has_voted(self, obj: PollOption) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.votes.filter(user=request.user).exists()
        return False

    def get_voters(self, obj: PollOption) -> list[dict]:
        if obj.poll.is_anonymous:
            return []
        voters = [vote.user for vote in obj.votes.all()]      # <- already prefetch-friendly
        return PollVoterSerializer(voters, many=True).data
...
    def get_total_voters(self, obj: Poll) -> int:
        return PollVote.objects.filter(option__poll=obj).values("user_id").distinct().count()
```

The prefetches that make a cache available (`backend/apps/forum/views.py`): `ThreadDetailView.queryset` (line ≈660) and `ThreadDetailBySlugView.get_object` (line ≈695) prefetch `posts__poll__options__votes__user`; the post list view (line ≈916) prefetches `poll__options__votes__user`.

`backend/apps/food/serializers.py:171-187` — `MealRegistrationSerializer.get_available_portions(obj)` runs `FoodTicket.objects.filter(house=obj.house, date=obj.date).aggregate(...)` per serialized registration. `backend/apps/food/views.py:494-585` — `MealRegistrationListCreateView.list()` serializes up to 4 registrations per request (week view, Mon–Thu), each triggering that aggregate.

Conventions: ruff line-length 100; pytest-django tests in each app's `tests.py`; `django_assert_max_num_queries` fixture is available via pytest-django.

## Commands you will need

| Purpose | Command (from `/backend`) | Expected on success |
|---|---|---|
| Forum tests | `uv run pytest apps/forum/tests.py -v -k poll` | all pass |
| Food tests | `uv run pytest apps/food/tests.py -v` | all pass |
| Full suite | `uv run pytest` | all pass |
| Lint/typecheck | `uv run ruff check --fix . && uv run ruff format . && uvx ty check` | exit 0 |

## Scope

**In scope**: `backend/apps/forum/serializers.py` (poll serializers only), `backend/apps/food/serializers.py` (`get_available_portions` only), `backend/apps/food/views.py` (`MealRegistrationListCreateView.list` only), `backend/apps/forum/tests.py`, `backend/apps/food/tests.py`.

**Out of scope**:

- The view-level prefetch chains — they are already correct.
- API response shapes — `vote_count`, `has_voted`, `voters`, `total_voters`, `available_portions` keys and values must be identical.
- `FoodTicketCreateSerializer` (plan 004's territory).
- Poll vote/add-option write views (`PollVoteView`, `PollAddOptionView`).

## Git workflow

- Branch: `advisor/005-food-poll-n-plus-one`
- Commits per logical unit, e.g. `perf: poll serializers use prefetched votes` and `perf: batch ticket aggregate in meal registration week view`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Make poll serializers consume the prefetch cache

In `backend/apps/forum/serializers.py`:

```python
    def get_vote_count(self, obj: PollOption) -> int:
        return len(obj.votes.all())   # uses prefetch cache when present

    def get_has_voted(self, obj: PollOption) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return any(v.user_id == request.user.id for v in obj.votes.all())
        return False
```

And in `PollSerializer`:

```python
    def get_total_voters(self, obj: Poll) -> int:
        return len({v.user_id for option in obj.options.all() for v in option.votes.all()})
```

(`options` is the related name used by `PollOptionSerializer` nesting — confirm with `grep -n "related_name" backend/apps/forum/models.py | grep -i option`.)

**Verify**: `uv run pytest apps/forum/tests.py -v -k poll` → all pass.

### Step 2: Query-count regression test for thread detail with a poll

In `backend/apps/forum/tests.py`, add a test that creates a thread whose post has a poll with 3 options and votes from 2 users, then fetches the thread detail endpoint inside `django_assert_max_num_queries(N)`. Determine `N` empirically AFTER Step 1 (run once, read the count, set the bound to that count) and add a comment: `# regression bound: poll fields must not add per-option queries`.

**Verify**: the new test passes; temporarily reverting Step 1 makes it fail (do this check locally, then restore).

### Step 3: Batch the ticket aggregate in the meal-registration week view

In `MealRegistrationListCreateView.list()` (`backend/apps/food/views.py`), after `real_regs` is built, compute one grouped aggregate for the house and week:

```python
        ticket_totals = {
            row["date"]: row
            for row in FoodTicket.objects.filter(
                house=house, date__gte=week_start, date__lte=week_start + timedelta(days=3)
            )
            .values("date")
            .annotate(
                total_meat=Coalesce(Sum("adults_meat"), 0),
                total_veg=Coalesce(Sum("adults_veg"), 0),
                total_children=Coalesce(Sum("children_count"), 0),
            )
        } if house else {}
```

Pass it via serializer context: `context={"request": request, "ticket_totals": ticket_totals}` at BOTH `MealRegistrationSerializer(...)` call sites in `list()` (real rows and materialized rows). Then in `MealRegistrationSerializer.get_available_portions`, use the context when present:

```python
    def get_available_portions(self, obj: MealRegistration) -> dict[str, int]:
        """...keep existing docstring..."""
        totals = self.context.get("ticket_totals")
        if totals is not None:
            existing = totals.get(
                obj.date, {"total_meat": 0, "total_veg": 0, "total_children": 0}
            )
        else:
            existing = FoodTicket.objects.filter(house=obj.house, date=obj.date).aggregate(...)
        ...
```

The fallback keeps the detail view (single object) working unchanged. Mind the imports (`Coalesce`, `Sum` are already imported in `food/serializers.py`; check `food/views.py`).

**Verify**: `uv run pytest apps/food/tests.py -v` → all pass.

## Test plan

- Forum: Step 2's query-count test, plus assert that `vote_count`, `has_voted`, `total_voters` values in the thread-detail response are correct for a poll with overlapping voters (one user voted 2 options on an `allow_multiple_votes` poll → `total_voters == 1`). Model on existing poll tests (`grep -n "poll" backend/apps/forum/tests.py | head`).
- Food: a week-view test asserting `available_portions` equals registration minus tickets for a date that has both a listed and a claimed ticket — same expected values as before the change. Use `django_assert_max_num_queries` on the week-view endpoint with a bound set empirically post-fix.
- `uv run pytest` → full suite green.

## Done criteria

- [ ] `uv run pytest` exits 0, including ≥3 new tests (1 forum query-count, 1 forum values, 1 food)
- [ ] `grep -n "obj.votes.count()" backend/apps/forum/serializers.py` → no matches
- [ ] `grep -n "PollVote.objects.filter(option__poll=obj)" backend/apps/forum/serializers.py` → no matches
- [ ] Lint/format/typecheck exit 0
- [ ] No files outside scope modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- The poll response values change for anonymous polls or `allow_multiple_votes` polls (semantics drift — report the diff).
- `get_available_portions` turns out to be consumed by another view passing different context than expected.
- The `options`/`votes` related names don't match the excerpts.

## Maintenance notes

- The poll serializers are now correct ONLY in tandem with the views' `prefetch_related` — if a new view serializes polls without prefetching, it degrades to N+1 silently (functionally still correct). The query-count test pins the hot path.
- If meal-registration listing ever serializes more than one house (e.g. an admin overview), extend `ticket_totals` keying to `(house_id, date)`.
