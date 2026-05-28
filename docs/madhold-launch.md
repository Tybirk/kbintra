# Madhold launch — design & implementation notes

Status: in progress. This document captures the decisions made while turning the
hidden "Madhold" (cooking-team) functionality into a first-class, launched feature.
The user was AFK during the build, so every non-obvious decision is recorded here.

## Goal

Launch food teams ("madhold") as a real, usable feature:

1. **Visible** in navigation (currently commented out).
2. A **modern generation algorithm** (ported from the standalone `~/Desktop/madhold`
   CLI, which is the up-to-date version — the in-repo generator was stale).
3. **Switching teams**: keep the existing 1:1 swap, add a "take over" (favour/debt)
   flow, and add a **broadcast "bytteanmodning"** to everyone who could plausibly take
   the shift.
4. **Dashboard surfaces**: a subtle "today's team" line on the food widget, and a big
   **action box at the top of the dashboard when you are on today's team**.
5. **New notifications + settings** (take-away ready, leftovers ready, day-before
   reminder, swap requests) grouped into natural categories, with sensible
   preference defaults derived from each user's meal preferences.
6. **Self-service personal food settings** (head-chef candidate, cook-with-housemate,
   unavailable-this-cycle), plus easy admin/test configuration.
7. **Testing tooling** to simulate a realistic cycle (70 % of residents submit wishes).

## Key decision: extend, don't rewrite

The existing schema is good and is kept:

- `FoodTeamCycle` (status flow COLLECTING_WISHES → GENERATING → FINALIZED → ARCHIVED),
  `cooking_dates` (JSON list of ISO dates), `wish_deadline`.
- `FoodTeam` (one per date, FK to cycle), `FoodTeamMember` (user + cached house_number).
- `FoodTeamWish` (user's `available_dates` per cycle; empty = available all dates).
- `TeamSwapRequest` (atomic 1:1 swap, already implemented and used by the frontend).
- User flags: `is_exempt_from_food_teams`, `is_over_50`, `can_be_head_chef`,
  `prefers_cooking_with_housemate`, `default_cooking_days`, `food_team_comment`,
  `is_food_admin` / `has_food_admin` (is_staff implies food admin).
- `DriveMenuCache` (week menus from Google Drive, `drive_folder_id` per week).

## Algorithm port (`services/team_generator.py`)

The in-repo generator placed couples first then singles, with weaker repair. The
`~/Desktop/madhold/madhold.py` version is better and is the source of truth. Ported
faithfully into the Django service, keeping DB integration:

- **Unit-based**: couples (two housemates both flagged `prefers_cooking_with_housemate`,
  scheduled on the *intersection* of their wishes) and singles go through one ordering:
  fewest date-options first, then head-chefs first, then over-50 first. This is the main
  improvement over "couples first".
- **Least-filled placement**: within a unit's options pick the date with the most slack,
  ties broken by fewest head-chefs already there (spreads chefs).
- **Swap repair** for anyone unplaced; **overflow** pass (team_size+1) for leftovers;
  **rebalance** passes for over-50 and head-chef distribution.
- **Auto-escalation**: if anyone is unplaced, restart the whole assignment with
  `max_old_per_day += 1` up to a ceiling (default 4). Prints which people triggered it.
- Couples with no common dates: surfaced as a warning and degraded to singles
  (we don't hard-fail a web action; the CLI dies, the service warns).

Constraints (unchanged): team size 6 (overflow to 7), max 2 over-50/team, ≥1 and ≤3
head-chefs/team, no two housemates on a date unless they're a flagged couple.

`is_unavailable` on `FoodTeamWish` (new) lets a user opt out of a single cycle; the
generator skips those users for that cycle (distinct from the permanent
`is_exempt_from_food_teams`).

## Switching teams

Three mechanisms:

1. **Bytte (1:1 swap)** — existing `TeamSwapRequest`. Unchanged behaviour.
2. **Overtag (take over / favour)** — `TeamTakeover`: user A takes over user B's shift.
   B is removed from the team, A is added (A keeps any existing shift, so A may cook
   twice this cycle), and a `FoodTeamFavour(creditor=A, debtor=B)` ledger row is created
   so "B owes A one" next cycle. Favours are displayed and can be marked settled; they
   are informational, not auto-enforced (community trust model, keep it simple/robust).
3. **Broadcast bytteanmodning** — `SwapBroadcast`: A wants rid of date D and lists the
   dates A *is* available. The system finds candidates = users who (a) indicated they
   could cook D (via this cycle's wish OR matching `default_cooking_days` weekday) **and**
   (b) currently hold a membership on one of A's available dates. Each candidate gets a
   `FOOD_TEAM_SWAP_REQUEST` notification. The first to accept performs an atomic swap
   (A ↔ candidate, A takes D-relief, candidate moves to D... actually: candidate's date
   ↔ A's date D) and the broadcast closes; remaining notifications show "already taken"
   when opened. A can also **share to the Fælles forum** — a manual button that opens a
   pre-filled new thread in the Fælles subgroup (no auto-posting).

## Dashboard

- **Food widget (subtle)**: one muted line "Dagens madhold: <names>" under the menu.
- **Action box (prominent, top of dashboard, only when you are on today's team)**:
  - Today's team members.
  - Link to today's **recipe folder** (`drive.google.com/drive/folders/<drive_folder_id>`).
  - Links to **individual recipes**: the week folder holds one spreadsheet with sheets
    named `Ma1, Ma2, Ti1, Ti2, On1, On2, To1, To2` (Ma=Mandag … To=Torsdag). Each sheet's
    **A1 cell holds the dish name**. We parse the spreadsheet, map today's weekday prefix
    to its sheets, and deep-link each sheet (Google Sheet → `#gid=<id>`; uploaded .xlsx →
    link to the file). Cached on `DriveMenuCache.recipe_sheets` (JSON), refreshed with the
    menu. See `services/recipe_sheets.py`.
  - **"Take away klar"** button → `FOOD_TEAM_TAKEAWAY_READY` notification to the community
    (gated per-user preference).
  - **"Rester er klar"** button (optional image upload) → `FOOD_TEAM_LEFTOVERS_READY`.
  - **Eating counts** per serving (take-away / eat-in 17:30 / eat-in 18:30) with each
    serving's share of the day's total. Children count as ½ in the percentage
    (weighted = adults + 0.5·children); reuses the existing daily-stats computation.

## Notifications + settings

New `NotificationType`s: `FOOD_TEAM_REMINDER`, `FOOD_TEAM_TAKEAWAY_READY`,
`FOOD_TEAM_LEFTOVERS_READY`, `FOOD_TEAM_SWAP_REQUEST`. Each gets `notify_/email_/push_`
preference fields on `NotificationPreference`.

- **Day-before reminder**: `@db_periodic_task` daily 20:00 → members cooking the next
  cooking day get `FOOD_TEAM_REMINDER`.
- **Settings grouping**: the flat 30-ish switches are grouped in the UI into natural
  categories — Beskeder, Forum, Vigtige opslag, Arrangementer, **Mad** (tickets + team
  reminder/takeaway/leftovers/swap). Grouping metadata lives in one place
  (`NOTIFICATION_GROUPS`) and drives the settings page.
- **Preference defaults derived from meal preferences** (data migration over existing
  users; helper for new ones):
  - `*_food_takeaway_ready` ON for users who have **any** `MealPreference` with
    `dining_option = take_away` (they pick up take-away, so they want the heads-up).
  - `*_food_leftovers_ready` ON for users with **≥3 of 4** weekdays defaulting to
    `seating_time = 17:30` (the 18:30 crowd sees leftovers in person; no notification
    needed).
  - `*_food_team_reminder` ON by default for everyone (it's about *your* duty).

## Self-service personal food settings

`GET/PATCH /api/food/my-food-profile/` exposes on the current user:
`can_be_head_chef`, `prefers_cooking_with_housemate`, `is_over_50`,
`is_exempt_from_food_teams`, `default_cooking_days`, `food_team_comment`. Admins keep the
Django admin + a roster endpoint to configure others. "Unavailable for the next period"
is the per-cycle `FoodTeamWish.is_unavailable`, set from the wish UI.

## Testing tooling

`python manage.py seed_food_teams_test` (idempotent, dev only):
- Builds a cycle of 16 cooking days (next Mon–Thu run, skipping `ClosedFoodDay`s).
- Optionally configures flags across users: `--headchef-pct`, `--exempt-pct`,
  `--couples N`, `--over50-pct`.
- Simulates wishes: `--wish-pct 70` of users submit a random plausible subset of dates.
- `--generate` to immediately run the generator and report the result.

## Open questions / assumptions

- Recipe spreadsheet deep-linking only yields true per-sheet links for native Google
  Sheets (gids available via the Sheets/Drive API). For uploaded `.xlsx` we link to the
  file and show dish names parsed from A1.
- Take-away/leftovers notifications go community-wide, gated by preference; guarded to
  once per team/type/day to prevent spam.
- Favours are an honour-system ledger, not auto-enforced.

## Post-build refinements

- **Closed broadcasts stay visible to former candidates.** Original prompt: "if someone
  has accepted the request, this should be clear when you click the notification." The
  first cut filtered the broadcast list to `status=OPEN` for candidates, so clicking the
  notification after another candidate accepted showed an empty list. Fixed by:
  (a) backend `SwapBroadcastListCreateView.get_queryset` now returns any broadcast from
  the last 14 days where the user was a candidate (regardless of status), and
  (b) `IncomingBroadcastCard` renders "Allerede accepteret af X" / "Anmodningen er
  trukket tilbage" for `accepted`/`cancelled` instead of hiding them. The "Bytte" tab
  badge still only counts truly actionable open broadcasts.

## Known gaps

- **Admin roster UI is backend-only.** `GET /api/food/admin/roster/` and
  `PATCH /api/food/admin/roster/<id>/` are implemented (food-admin gated) for
  bulk-configuring flags on other users, but no frontend page renders them yet.
  Self-service via `Min profil` is the primary path; Django admin works for one-offs.
