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

### Wish-based allocation

Users declare which dates they're available to cook. If a user submits no wish, they default to available for ALL dates (fairness). The generator in `services/team_generator.py` assigns people to teams respecting constraints.

### Team constraints

- Target 6 members per team
- Max 2 over-50 members per team
- At least 1 head chef per team (max 3)
- No same-house members unless `prefers_cooking_with_housemate`
- People with fewest available dates assigned first

### Atomic swaps

`TeamSwapRequest`: accepting a swap atomically swaps both users' memberships and cancels all other pending requests involving either membership.

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
