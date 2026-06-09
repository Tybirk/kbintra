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

### Fixed portion pricing

Adult meat: 37 DKK, adult veg: 26 DKK, child: 18 DKK. Used for ticket auto-pricing and monthly cost reports. Defined in `constants.py`.

### Monthly cost reports only use post-deadline data

The admin cost endpoint materializes any missing registrations first, then calculates. This ensures billing accuracy — no one can change portions after the report is generated.

## Food Teams (Cooking Rotation)

### Cycle-based, not ad-hoc

Teams are planned in explicit `FoodTeamCycle` periods with status flow: `COLLECTING_WISHES` -> `GENERATING` -> `FINALIZED` -> `ARCHIVED`. Cannot regenerate once finalized without deleting teams first.

### Next-cycle planning (create form defaults)

`services/cycle_planning.py` centralises "what should the next period look like": **eligible cooks** = active users with `is_exempt_from_food_teams=False` (children aren't users); **suggested cooking days** = `round(eligible / 6)` (teams target 6, overflow 7); **dates** = the next Mon–Thu days skipping `ClosedFoodDay`s, continuing after the latest existing cycle so periods don't overlap. `GET cycles/suggested/` (food-admin) returns `{eligible_count, suggested_day_count, name, cooking_dates, wish_deadline}` and the "Opret periode" modal auto-prefills (editable) from it. The seeder reuses the same helpers. Initial resident flags were seeded from the cooking team's roster in `users/migrations/0012_seed_food_team_flags.py`.

### Wish-based allocation

Users declare which dates they're available to cook. If a user submits no wish, they default to available for ALL dates (fairness). A wish with `is_unavailable=True` opts the user out of *that cycle* entirely (distinct from the permanent `is_exempt_from_food_teams`). The generator in `services/team_generator.py` assigns people to teams respecting constraints.

### Generator algorithm (ported from the `~/Desktop/madhold` CLI)

`services/team_generator.py` is a faithful port of the standalone scheduler. Key points:
- **Unit-based**: couples (two housemates both flagged `prefers_cooking_with_housemate`, scheduled on the *intersection* of their wishes) and singles go through one ordering — fewest options, then head-chefs first, then over-50 first — placing each on the least-filled valid date. This beats "couples first".
- Repair pipeline: swap-repair for unplaced people, overflow (team_size+1), then rebalance passes for over-50 and head-chefs.
- **Auto-escalation**: if anyone is unplaced, the whole assignment restarts with `max_old_per_day += 1` up to a ceiling (4). Tunable via class constants (`TEAM_SIZE`, `OVERFLOW`, `MAX_OLD_PER_DAY_START/CEILING`, `MAX_HEADCHEFS_PER_DAY`, `REBALANCE_ITERATIONS`).
- Couples with no common dates degrade to singles with a warning (web action never hard-fails).

### Team constraints

- Target 6 members per team (overflow to 7)
- Max 2 over-50 members per team (auto-escalates if needed)
- At least 1 head chef per team (max 3)
- No same-house members unless `prefers_cooking_with_housemate`

### Switching shifts (three mechanisms)

1. **Bytte (1:1 swap)** — `TeamSwapRequest`: accepting atomically swaps both memberships and cancels other pending requests involving either membership.
2. **Overtag (takeover/favour)** — `POST teams/takeover/` reassigns a membership to the requester and records a `TeamFavour(creditor, debtor)` honour-system ledger ("you owe me one"). See `favours/` + `favours/<id>/settle/`.
3. **Broadcast bytteanmodning** — `SwapBroadcast`: the requester offers to take any of several dates; candidates (who indicated availability for the offered date via wish or `default_cooking_days`, and currently cook one of the requester's dates) are notified. First to accept performs an atomic swap. NOTE: JSONField `__contains`/`__overlap` lookups are unsupported on SQLite, so candidate matching filters in Python.

### Self-service & test tooling

- `my-food-profile/` (GET/PATCH) lets users set their own `can_be_head_chef`, `prefers_cooking_with_housemate`, `is_over_50`, `is_exempt_from_food_teams`, `default_cooking_days`, `food_team_comment`. Admins use `admin/roster/` to configure others.
- `python manage.py seed_food_teams_test` builds a 16-day cycle, optionally configures flags (`--headchef-pct`, `--couples`, etc.), simulates wishes (`--wish-pct 70`), and `--generate`s. Dev only.

### Today action box & team notifications

- `teams/today/` returns whether you're on today's team, the members, the recipe-folder URL, and per-dish recipe links (parsed from the week folder's spreadsheet — sheets `Ma1/Ti2/…`, dish name from cell C1 since cols A/B are hidden ingredient columns; see `services/recipe_sheets.py`).
- `teams/<id>/notify-takeaway/` and `teams/<id>/notify-leftovers/` (image upload supported) broadcast to the community, gated by the new notification preferences. A day-before reminder fires via a 20:00 periodic Huey task.

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
| `constants.py` | Prices, day names |
| `tasks.py` | Thursday materialization task |
| `services/team_generator.py` | Team generation algorithm |
| `services/drive_menu.py` | Google Drive menu fetching |
| `urls.py` | 20 URL patterns |
