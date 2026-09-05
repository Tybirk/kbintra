# Food System

The food system manages shared meals for the community: registrations, ticket trading, cooking team rotation, and billing.

## Key Design Dogmas

### Registrations are per-house, not per-user

One `MealRegistration` per house per date (DB unique constraint). All inhabitants of a house share the same registration. Anyone in the house can edit it.

### Preferences and registrations are separate concepts

`MealPreference` = mutable defaults (per house, per day-of-week). `MealRegistration` = concrete commitment for a specific date, immutable after deadline. Changing a preference does NOT retroactively change existing registrations.

### Virtual-to-materialized pattern

Pre-deadline: if a house has no registration for a date, the API returns a "virtual" registration computed from preferences (or system defaults). Post-deadline: missing registrations are materialized into real DB rows (frozen snapshots). A Huey periodic task (`materialize_week_registrations`) runs every Thursday at 00:30 to lock in next week. Views also materialize on-demand for post-deadline dates.

### Strict Wednesday 23:59:59 deadline

The deadline for next week's meals (Mon-Thu) is Wednesday 23:59:59 of the current week. Pre-deadline: all fields editable. Post-deadline: only `dining_option` and `seating_time` can change; portion counts are locked. Enforced in serializer validation, not just UI.

### Tickets are completely separate from registrations

Tickets are a secondary trading layer ("I don't need my portions, anyone want them?"). They do NOT modify registration counts. They only exist after the deadline (when registrations are locked). The stats endpoint deducts available tickets from totals for display purposes, but the registrations themselves are never changed.

### Anti-double-selling on tickets

When computing available portions for new ticket creation, both available AND claimed tickets count toward the limit. A claimed ticket still "uses" the portion (it belongs to the claimer now). Released tickets go back to available. This prevents overselling.

### Meat only on Wednesday

`adults_meat > 0` is only valid when day_of_week == 2 (Wednesday). Enforced in both `MealPreference` and `MealRegistration` serializers.

### Cooking happens Mon-Thu only

No meals on Friday, Saturday, or Sunday.

### Portion prices are date-versioned, never "current"

Prices live in the `MealPrice` table: each row is a price set with an `effective_from` date. **Every lookup is anchored to the meal date**, never to today — that is what keeps past cost reports, economy pages and ticket prices from silently changing when prices go up. Resolution lives in `pricing.py` (`get_prices(meal_date)`, or `get_price_schedule()` once when pricing many dates in a loop).

Current sets: 37/26/18 DKK from the beginning, 40/30/18 DKK from 2026-08-02 (adult meat / adult veg / child).

Food admins manage prices from the Admin tab on `/mad/admin`. A price set that has already taken effect cannot be edited or deleted (enforced in `MealPriceSerializer` and `MealPriceDetailView`); backdating a new set is rejected for the same reason. The frontend mirrors the resolution logic in `utils/priceCalculation.ts` and reads the schedule via `useMealPrices()`.

### Monthly cost reports only use post-deadline data

The admin cost endpoint materializes any missing registrations first, then calculates. This ensures billing accuracy — no one can change portions after the report is generated.

## Food Teams (Cooking Rotation)

### Cycle-based, not ad-hoc

Teams are planned in explicit `FoodTeamCycle` periods with status flow: `COLLECTING_WISHES` -> `GENERATING` -> `FINALIZED` -> `ARCHIVED`. Cannot regenerate once finalized without deleting teams first.

### Undoing a finalized cycle

`GET/POST cycles/<id>/reset-teams/` (food-admin) is the in-app escape from a plan the admin dislikes: POST deletes the cycle's teams in one transaction and sets it back to `COLLECTING_WISHES` so generation runs again; GET previews the same counts without touching anything (the confirmation modal needs them). **Refused once any cooking date has passed** — people have cooked by then, and deleting the teams would erase that history. Deleting `FoodTeam` cascades to `FoodTeamMember` -> `TeamSwapRequest` + `SwapBroadcast`; `TeamFavour` does *not* cascade (it only holds `cycle` SET_NULL + a bare `origin_date`), so this cycle's favours are deleted explicitly. Wishes and the cycle row itself survive.

### Next-cycle planning (create form defaults)

`services/cycle_planning.py` centralises "what should the next period look like": **eligible cooks** = active users with `is_exempt_from_food_teams=False` (children aren't users); **suggested cooking days** = `eligible // 6` (teams target 6 and never go below it — leftovers overflow to 7 rather than opening a half-staffed day, so 89 cooks means 14 days, not 15); **dates** = the next Mon–Thu days skipping `ClosedFoodDay`s, continuing after the latest existing cycle so periods don't overlap. `GET cycles/suggested/` (food-admin) returns `{eligible_count, suggested_day_count, name, cooking_dates, wish_deadline}` and the "Opret periode" modal auto-prefills (editable) from it. The seeder reuses the same helpers. Initial resident flags were seeded from the cooking team's roster in `users/migrations/0012_seed_food_team_flags.py`.

### Too few cooks shortens the period, it never thins the teams

The pool moves between cycle creation and generation — people set `is_unavailable` on their wish, or get exempted, after the admin picked the dates. So `TeamGenerator._trim_dates_to_capacity()` re-applies the `eligible // 6` rule at generation time and **drops dates from the end** until every remaining team can be full (overflowing to 7). Dropped dates are *not* closed food days and need no admin action: `cycle_planning.suggested_start_date()` starts the next period the day after this cycle's last cooking date, so the leftovers are simply the first dates of the next cycle. `save_teams()` therefore writes the trimmed list back to `cycle.cooking_dates` — without that the next cycle would skip past them.

Anyone whose wish covered *only* dropped dates is stood down for this cycle rather than forced onto a day they said they couldn't do; they're named in a warning and are first in line next period. The dropped dates come back in `TeamGenerationResult.dropped_dates` and the admin sees them in the result modal.

### Wish-based allocation

Users declare which dates they're available to cook. If a user submits no wish, they default to available for ALL dates (fairness). A wish with `is_unavailable=True` opts the user out of *that cycle* entirely (distinct from the permanent `is_exempt_from_food_teams`). The generator in `services/team_generator.py` assigns people to teams respecting constraints.

### Generator algorithm (ported from the `~/Desktop/madhold` CLI)

`services/team_generator.py` is a faithful port of the standalone scheduler. Key points:
- **Unit-based**: couples (two housemates both flagged `prefers_cooking_with_housemate`, scheduled on the *intersection* of their wishes) and singles go through one ordering — fewest options, then head-chefs first, then over-50 first — placing each on the least-filled valid date. This beats "couples first".
- Repair pipeline: swap-repair for unplaced people, overflow (team_size+1), then rebalance passes for over-50 and head-chefs.
- **Auto-escalation**: if anyone is unplaced, the whole assignment restarts with `max_old_per_day += 1` up to a ceiling (4). Tunable via class constants (`TEAM_SIZE`, `OVERFLOW`, `MAX_OLD_PER_DAY_START/CEILING`, `MAX_HEADCHEFS_PER_DAY`, `REBALANCE_ITERATIONS`).
- **Refuses rather than quietly compromises.** A couple we can't honour (only one
  housemate flagged, or no date they can both cook) raises `SchedulingError`, and so
  does a final plan whose short teams could still be filled from the surplus — the
  message names the person and date, nothing is saved, and the cycle stays in
  `COLLECTING_WISHES`. Teams that are short because too few people signed up are an
  input problem and only warn. Pass `allow_couples_without_common_dates=True` to
  schedule an un-pairable couple singly instead.
- **`balance_team_sizes()`** evens a 7/5 split into 6/6 after placement. A 1-for-1
  switch can't fix that (it preserves both sizes), so it searches for a *chain* of
  wished-for moves (up to `MAX_MOVE_CHAIN`) ending on an under-full date; only the
  two ends change size. Couples are placed as a pair and are never moved singly.

### Team constraints

- Target 6 members per team (overflow to 7)
- Max 2 over-50 members per team (auto-escalates if needed)
- At least 1 head chef per team (max 3)
- No same-house members unless `prefers_cooking_with_housemate`

### Switching shifts (three mechanisms)

1. **Bytte (1:1 swap)** — `TeamSwapRequest`: accepting atomically swaps both memberships and cancels other pending requests involving either membership.
2. **Overtag (takeover/favour)** — `POST teams/takeover/` reassigns a membership to the requester and records a `TeamFavour(creditor, debtor)` honour-system ledger ("you owe me one"). See `favours/` + `favours/<id>/settle/`.
   Pass `settle_favour_id` to go the *other* way and work off a favour you already owe: the shift still moves, but that debt is marked settled instead of a new one being minted in the taker's name (validated: only the debtor, and only against the creditor's own shift). `favours/<id>/repay-options/` lists the creditor's upcoming shifts for that picker, minus days the debtor already cooks.
   Taking a shift is **unilateral** — the other person only finds out afterwards — so the UI deliberately does *not* offer it beside every name on every team. It appears where someone has asked to be relieved (an incoming bytteanmodning) and in "Jeg skylder", where it settles up.
3. **Broadcast bytteanmodning** — `SwapBroadcast`: the requester offers to take any of several dates; candidates (who indicated availability for the offered date via wish or `default_cooking_days`, and currently cook one of the requester's dates) are notified. First to accept performs an atomic swap. NOTE: JSONField `__contains`/`__overlap` lookups are unsupported on SQLite, so candidate matching filters in Python.

### Self-service & test tooling

- `my-food-profile/` (GET/PATCH) lets users set their own `can_be_head_chef`, `prefers_cooking_with_housemate`, `is_exempt_from_food_teams`, `default_cooking_days`, `food_team_pause_reason`.

### Over 50 comes from the birthdate, not from a second question

`User.is_over_50_effective` is what the generator and the admin roster read: the age from `User.birthdate` when we have one (107 of 109 residents do), and only otherwise the stored `is_over_50` flag. Nobody has to keep a second copy of their own age current, and nobody quietly ages out of the balancing rule. The profile page therefore only shows the "Jeg er over 50" switch to residents without a birthdate (`has_birthdate` on `my-food-profile/` says which), and PATCHing `is_over_50` for someone whose birthdate we know is rejected rather than silently ignored.

### Two ways of sitting out, and the reason for each

Deliberately separate, and the overview keeps them apart:
- **`User.is_exempt_from_food_teams`** — set on the person, lasts until they turn it off ("Jeg holder pause fra madhold"). Not framed as permanent: a season away uses the same switch.
- **`FoodTeamWish.is_unavailable`** — this period only, from the wish; resets with the cycle.

**One reason for both**, and it lives on the person: `User.food_team_pause_reason`. A reason stored on the wish would die with the cycle, so the organiser could never come back and ask whether the break is still needed — which is the whole point of recording it. Both the profile switch and the wish form write to this one field. Submitting a wish with real dates is how someone says they are back, so it lifts `is_exempt_from_food_teams` and clears the reason in the same call — leaving the pause on would have the generator skip a person who just signed up. The wish form says so before you submit. `FoodTeamWish.comment` was removed (it was never non-empty).

When an admin opens a new period (`POST cycles/`), `tasks.notify_paused_residents_of_new_cycle` asks everyone with a standing pause whether it still holds (`FOOD_TEAM_PAUSE_CHECK`, linking to `/madhold/profil`). Wishes opening is the last moment where the answer can still change the plan, and a pause set months ago is otherwise never revisited. Doing nothing keeps the pause on. The type has no preference toggle — it is asked a handful of times a year — and piggybacks on any email/push channel the user has enabled.

`GET admin/roster/` (food-admin) returns `{cycle, residents}` where each resident carries both states with their reasons, plus `house_number` and `has_submitted_wish`. Wishes for the period are prefetched into serializer context, so the roster is two queries, not one per resident. The **Beboeroverblik** section at the top of the Admin tab renders it: holder pause / ikke med i denne periode / chefkokke / vil lave mad med medbeboer, The wish comment is only asked for when someone marks themselves out of the period — the date picker already says precisely when they can cook, so a free-text note about availability only repeats it.

The old `User.food_team_comment` was removed: it was labelled "til madhold-ansvarlig" but exposed only on `my-food-profile`, so its only reader was its author. It was empty for all 111 users.
- `python manage.py seed_food_teams_test` builds a 16-day cycle, optionally configures flags (`--headchef-pct`, `--couples`, etc.), simulates wishes (`--wish-pct 70`), and `--generate`s. Dev only.

### Today action box & team notifications

- `teams/today/` returns whether you're on today's team, the members, the recipe-folder URL, and per-dish recipe links (parsed from the week folder's spreadsheet — sheets `Ma1/Ti2/…`, dish name from cell C1 since cols A/B are hidden ingredient columns; see `services/recipe_sheets.py`).
- `teams/<id>/notify-takeaway/` and `teams/<id>/notify-leftovers/` (image upload supported) broadcast to the community, gated by the new notification preferences. A day-before reminder fires via a 20:00 periodic Huey task.

### The household, not just the cook

A shift is a household's evening, so both halves of it are told about it:
- `teams/housemates/` lists the *upcoming* teams the other residents of your house cook on, with `members_preview` (every member, the household ones flagged). Days you cook together are left out — "Mine hold" already shows those, with both names on the card. The page merges these into the Mine hold list by date rather than heading a second list: the card prints every name unexpanded, and the resident from your own house in bold, which is what says why the day is there.
- The 20:00 reminder task notifies each cook and then the rest of each cook's house (`notify_food_team_housemate_reminder`, "Anna har madhold i morgen"). It reuses `FOOD_TEAM_REMINDER`, so one preference governs both, and it skips housemates who are on the team themselves — nobody gets two reminders for one evening.

"Household" is the house (`utils.housemates_of`); that is the only grouping the app has, and what "min medbeboer" already meant here.

## Menus come from Google Drive

Google Drive is the **source of truth** for weekly menus. Cooking teams write menus as .docx files in a shared Drive folder. The app fetches and caches them via `services/drive_menu.py` (`DriveMenuCache` model, 12-hour TTL). The app never creates or edits menus — it only reads and displays them. Lookup is by ISO week number + year.

## Stats are computed, not stored

`DailyRegistrationStatsView` computes totals on the fly: active registrations + virtual contributions (pre-deadline) - available tickets + claimed ticket adjustments. Bucketed by dining_option x seating_time.

## Key Files

| File | Purpose |
|------|---------|
| `models.py` | All 11 models |
| `serializers.py` | Validation logic, deadline enforcement |
| `views.py` | API endpoints (~1,460 lines) |
| `constants.py` | Day names, ticket sale cutoff |
| `pricing.py` | Date-anchored portion price resolution |
| `tasks.py` | Thursday materialization task |
| `services/team_generator.py` | Team generation algorithm |
| `services/drive_menu.py` | Google Drive menu fetching |
| `urls.py` | 20 URL patterns |
