# Madhold bug hunt (2026-10-02)

## Fix tracker (merged to `develop` on top of `madhold-go-live`)

Status per item; commits are listed under "Commits" below.

| ID | Bug | Status |
|---|---|---|
| S1 | 1:1 accept leaves the requester's broadcast open; broadcast accept moves whoever holds the day now | fixed: 1:1 accept closes broadcasts on both days; broadcast accept re-checks the holder |
| S2 | Bytte and broadcasts never expire | fixed: no create/accept/list once a day is before today; `can_accept` on 1:1 requests |
| S3 | Two simultaneous 1:1 accepts sharing a membership drop a cook | fixed: status and memberships read inside the transaction |
| S4 | English error messages users see (swap, generate, tickets, menu) | fixed: 14 messages in Danish (swap, generate, tickets, menu, date params) |
| N1 | Leftovers photo on `/mad/rester` signed over the wrong path | fixed: signer uses the URL path; new uploads stored site-relative |
| N2 | Time-bound madhold pushes keep the 48 h TTL | fixed: 20 h / 2 h / 3 h |
| C1 | Accounts without a house are invited, nudged and planned | fixed: `utils.residents()` / `food_team_pool()` for invite, nudge, generator, day count, roster, name matching |
| C2 | Periods can overlap; generating/resetting one deletes another's teams | fixed: create/edit refuses another period's dates; generate refuses them; generate/reset delete own teams only |
| C3 | "Generer hold" works before the wish deadline, with no confirmation | fixed: backend needs `before_deadline: true`; UI confirmation modal |
| C4 | Late period: suggested deadline after day 1's reminder; past days planned and announced | fixed: suggestion starts ≥ today+3, deadline ≤ 23:59 two days before; generator skips today and past |
| C5 | Reset allowed on a cooking day | fixed: `<=` today; reset modal text follows |
| C6 | Correcting a wish back to "kan ikke" leaves the pause lifted | fixed: `FoodTeamWish.lifted_pause(_reason)` (migration 0030) |
| C7 | "Alle hold" filters on the UTC date | fixed: `timezone.localdate()`, plus the same bug in 4 ticket spots |
| F1 | A failed fetch says you have no cooking days | fixed: `LoadError` with "Prøv igen" on Mine hold, Alle hold, Bytte, Ønsker, Profil, admin periods |
| F2 | Weekday chips/checkboxes lose a tap; checkbox save has no onError | fixed: `useDefaultCookingDays` (local draft, serial saves, onError) |
| F3 | Pause reason wiped by stale local state in Ønsker | fixed: one query key; untouched reason not sent |
| F4 | Leftovers upload uses the 30 s default timeout | fixed: 120 s with a photo |
| F5 | Lists go stale after takeover and broadcast-accept | fixed: `invalidateMadholdQueries` after takeover, broadcast accept, 1:1 answer |
| F6 | Bytte badge counts your own outgoing requests | fixed: badge counts `can_accept` requests + incoming broadcasts |
| F7 | `/madhold/admin` is blank for non-admins | fixed: unknown/admin slug redirects to Mine hold (replace) |

### Commits

| Commit | What |
|---|---|
| ea825ed | Backend: S1–S4, N1–N2, C1–C7, migration `food/0030`, `apps/food/CLAUDE.md` |
| 70005dd | Frontend: F1–F7, the C3 confirmation modal, and the C5 reset text |

These are the SHAs on `develop`, where the fixes were replayed on top of `madhold-go-live`
(c7f3a2c) on 2026-10-06. They first sat on `fix/madhold-bughunt` as 0ce9777 and 3d7f268.

### Verification (2026-10-03)

- **Backend:** the full suite passes, 1275 tests (`uv run pytest`). New tests: `apps/food/test_madhold_swap_integrity.py` and `test_madhold_cycle_lifecycle.py`. The generator fuzz (600 seeds) also passes, run once with DB access; it is not kept in the repo.
- **Frontend:** `npm run typecheck`, `lint` and `format:check` are clean, and `test:run` passes 655 tests, including the new `pages/FoodTeamsPage.madhold.test.tsx`.
- **End to end over HTTP:** the backend ran on 7010 and Vite on 5180 against a fresh seeded DB, using the requests the frontend makes, through the Vite proxy:
  - `can_accept` is true for the target and false for the requester.
  - A 1:1 accept cancels the requester's open broadcast.
  - Generate before the deadline returns 400 with the Danish deadline message. A dry run returns 200, and `before_deadline: true` plans the period and sends PLAN_READY to 12 cooks.
  - The house-less account is on no team, absent from the roster, and has no notifications.
  - The leftovers photo URL from `leftovers/today/` loads with no cookie or JWT (200 image/jpeg). Without its signature it is 401.
- **Not done:** a click-through in a real browser. The connected Chrome could not reach this machine's localhost.

Still open (not in this round):
- The import (`--replace` scope, dry run hiding clashes, swaps reverted by a re-import).
- The test server sending real reminders.
- Broadcast candidates when nobody has wishes or standing weekdays.
- A `ClosedFoodDay` added after planning (reminder still sent, generator still staffs it).
- The swap P2s other than the accept race.
- Live notifications not refreshing `/madhold` pages (`cacheInvalidation.ts`).
- The flags-import P2s.
- The deadline label without a time, re-nudging after a moved deadline, and the double-submit 500 on a wish.

Base: `madhold-go-live` at 8aee610. Every finding was also checked against 258bb3f
(takeaway pickup time), which changes none of them. Line numbers refer to 8aee610.

Baseline, run in `.worktrees/claude-madhold-bughunt-2026-10-02`:
- `uv run pytest apps/food apps/notifications apps/users`: 448 passed.
- Frontend `npm run typecheck`: clean.
- Frontend `npm run test:run`: 622 passed.

Repro tests are untracked in that worktree. Run backend ones from `backend/` with
`uv run pytest <file> -q`.

| File | Tests | How to read it |
|---|---|---|
| `backend/apps/food/test_bughunt_leftovers.py` | 1 | Fails = bug |
| `backend/apps/food/test_bughunt_swaps_state.py` | 7 | Passes = bug (asserts today's behaviour) |
| `backend/apps/food/test_bughunt_import_teams.py` | 7 | Passes = behaviour as described |
| `backend/apps/food/test_bughunt_import_flags.py` | 6 | Passes = behaviour as described |
| `backend/apps/food/test_bughunt_cycle_lifecycle.py` | 10 | Fails = bug |
| `backend/apps/food/test_bughunt_cycle_generator_fuzz.py` | 600 runs | Passes: generator is sound |
| `frontend/src/pages/bughunt-madhold.test.tsx` | 12 | Passes = bug (asserts today's behaviour) |

Severity:
- **P0**: can hurt this weekend's launch.
- **P1**: likely to bite in the first weeks or at the November opening.
- **P2**: edge case.

## Before the import (launch steps 1–2)

**P0. `--replace` only clears the PDF's own dates.**
- Where: `import_food_teams.py:329` (`FoodTeam.objects.filter(date__in=dates).delete()`).
- What happens if prod already has another cycle's teams (e.g. a generated trial): those on dates the PDF lacks survive with real residents on them. That covers week 42 (12–15/10) and anything after 20/10.
- Consequence: those residents get the 20:00 "Du har madhold i morgen" reminder.
- Status: VERIFIED (`test_replace_leaves_other_cycles_teams_outside_the_plan`).

**P1. The dry run hides the clash check.**
- Where: `import_food_teams.py:292` skips the check under `--dry-run`.
- What happens: step 1 prints "Alle 89 navne … intet er gemt" even when `--apply` will refuse, so the dry run never shows what `--replace` would delete.
- Status: VERIFIED (`test_dry_run_does_not_mention_existing_teams`).
- Mitigation: run the prod check under "Prod checks" below before step 2.

**P1. A corrective `--replace` after launch silently reverts in-app swaps.**
- Takeovers and accepted bytte are rolled back to the PDF's cook.
- Open broadcasts and swap requests cascade away with the teams.
- `TeamFavour` debts survive, so someone keeps owing a favour for a shift that went back.
- Nobody is told.
- The "Undo" line in `madhold-go-live.md` doesn't mention any of this.
- Status: VERIFIED (`test_replace_reverts_in_app_swaps_but_keeps_favour_debt`).

**P1. The test server will send real reminders once prod has teams.**
- From the first `deploy-test.sh` after the prod import, the copied DB contains the plan. The test Huey then sends the 20:00 reminder, and later the 17:30 wish nudge, by e-mail to real residents, whether or not `data/madhold-import.txt` exists.
- So the go-live doc's mitigation ("delete `data/madhold-import.txt`") no longer helps.
- Separately, a *dry run* with `REMOTE_DIR=/opt/kbintra-test2` already copies the plan to `data/madhold-import.txt` (`import-madhold.sh:84`). That arms an unattended `--replace` on the next test deploy (`deploy-test.sh:87-91`).
- Status: the dry-run copy is VERIFIED with stubbed ssh/scp. The live-e-mail part is INFERRED from the go-live doc, not checked on the host.

**P1. Name matching can silently pick a housemate.**
- Where: `roster_matching.py`.
- What happens: matching runs over active residents only, so a moved-out name lands on a similar-looking housemate. "Jens (10)" becomes Jes, and "Per (12)" becomes Pernille. Only a `tolket:` line marks it.
- What to do: read each of the 14 `tolket` lines in step 1's output by hand.
- Status: VERIFIED in `test_bughunt_import_teams.py`.

## Swaps (bytte, broadcast, overtag)

**P1. Accepting a 1:1 bytte leaves an open broadcast on the same day, which later moves the wrong person.**
- Where: `RespondSwapRequestView` (`views.py:1136-1140`) cancels other swap requests but not `SwapBroadcast`s on either membership. `AcceptSwapBroadcastView` (`views.py:2639-2665`) never checks that `requester_membership.user` is still the broadcaster.
- Scenario:
  1. Anna broadcasts d1.
  2. Anna then swaps d1↔d2 with Bo 1:1.
  3. Cai accepts the stale broadcast.
- Result: Bo is moved d1→d3 without being asked or told. Anna is told she now cooks d3, but she actually cooks d2.
- Status: VERIFIED (`test_accepted_1to1_swap_leaves_requesters_broadcast_open_and_it_then_moves_someone_else`).

**P1. Bytte and broadcasts never expire.**
- Where: neither accept path checks the date (`views.py:1077-1106`, `2609-2637`).
- What happens: `can_accept` stays true, so a request for a day that has passed is still shown, still counted in the badge, and can still be accepted. That rewrites who cooked and moves a future day.
- Status: VERIFIED (two tests in `test_bughunt_swaps_state.py`).

**P1. Broadcasts reach almost nobody in the imported period.**
- Where: `_compute_broadcast_candidates` (`views.py:2452`).
- Why: it counts someone as available only via a wish for this cycle or a matching `default_cooking_days`. The import creates no wishes. The generator does the opposite: someone with no wish and no weekdays is treated as available every day.
- Scale: in the June snapshot, 1 of 109 active users had standing weekdays.
- What the user sees: "Ingen mulige byttere fundet". But the broadcast *was* created and is visible in Bytte to anyone cooking the offered days. The modal stays open, so tapping again creates a duplicate.
- Status: code path VERIFIED (`test_broadcast_reaches_nobody_…`). The count is INFERRED from the June snapshot (`backend/db.sqlite3`), not today's prod.

**P2 swap issues:**
- Two simultaneous accepts sharing a membership can drop a cook. The status check and the loads happen outside `transaction.atomic`, and nothing is re-checked inside it (`views.py:1057-1106`). VERIFIED by simulation.
- Duplicate open broadcasts for the same day are allowed, so every candidate is notified twice. VERIFIED.
- A takeover of a broadcast day sets the broadcast to CANCELLED without `accepted_by`. Other candidates then see "trukket tilbage". VERIFIED.
- `available_dates` on a broadcast is not validated. Past dates, dates with no team, or the sender's own dates notify people about a swap that can't go through (`serializers.py:1224`). INFERRED.
- A favour can be repaid with today's already-cooked shift (`views.py:2758`, `serializers.py:1112`). INFERRED.
- Requests auto-cancelled by another accept or takeover vanish without telling their sender. INFERRED.
- English error messages a user will see:
  - `views.py:1079` "This request has already been processed."
  - `serializers.py:671` "You already have a pending swap request…"
  - Admin-facing: `serializers.py:912`.
  - Not madhold, but user-facing ticket messages are English too: `views.py:699`, `705`, `836`, `850`.

## Period lifecycle (before the November opening)

**P1. Accounts without a house are invited, nudged and planned as cooks.**
- Where: every audience filters on `is_active` and `~is_exempt_from_food_teams` only:
  - `tasks.py:208` (period opens)
  - `tasks.py:252` (17:30 nudge)
  - `team_generator.py:154` (generator pool)
  - `cycle_planning.eligible_food_team_count` (suggested day count)
- What happens: an active admin, test or shared account fills a seat on a November team.
- Status: VERIFIED (`TestHouselessAccounts`). Whether prod has such accounts is not checked.

**P1/P2. Periods can overlap, and generating one deletes the other's teams.**
- Where: `validate_cooking_dates` accepts dates that already have teams, and `save_teams` deletes by date across cycles (`team_generator.py:873`). Reset does the same (`views.py:1300-1304`).
- Consequence: the owners of those teams lose their day, and their swaps cascade away, with no notification.
- Status: VERIFIED (`TestOverlappingPeriods`).

**P2. A `ClosedFoodDay` added after planning is ignored.**
- The 20:00 reminder still fires for that day (`tasks.py:141`), and the generator still staffs it from the stored `cooking_dates`.
- Status: VERIFIED (`TestClosedDayAfterPlanning`).

**P2. "Generer hold" works before the wish deadline, with no confirmation.**
- Where: the guard (`serializers.py:912`) only refuses FINALIZED cycles.
- What a mis-click next to "Forhåndsvisning" does:
  - plans from partial wishes
  - sends PLAN_READY to every cook
  - closes the wish form
- Status: VERIFIED.

**P2 lifecycle edge cases:**
- A period opened less than 8 days before its first day gets a deadline after day 1's reminder. Generation also plans, and announces, days already past. VERIFIED.
- Reset is allowed on a cooking day (`_past_dates` uses `<`, `views.py:1325`), which deletes the team cooking tonight. VERIFIED.
- Correcting a wish from dates back to "kan ikke i perioden" leaves the pause lifted. VERIFIED.
- "Alle hold" uses the UTC date (`views.py:906`), so between 00:00 and 02:00 it shows yesterday. INFERRED.
- Moving the deadline after the nudge never re-nudges. INFERRED.
- The deadline label in notifications drops the time. INFERRED.
- A quick double wish submit can 500 on an `IntegrityError`. INFERRED.

## Notifications

**P1. The leftovers photo on `/mad/rester` carries a signature that can never verify.**
- Where: `NotifyLeftoversReadyView` stores an absolute URL (`views.py:2303`). `TodayLeftoversView` then signs it (`views.py:2358`), but `_media_relative_path` expects `/media/...` and signs `https:/host/media/...`.
- Consequence: the image falls back to the session cookie, which is exactly what signed URLs exist to avoid on iOS. The existing test only checks that `sig=` is present.
- E-mail images are signed correctly.
- Status: VERIFIED (`test_bughunt_leftovers.py` fails).
- Fix: store `rel_url`, or sign the path portion of the URL.

**P2. Time-bound pushes keep the 48 h default TTL.**
- Where: `services.py:99-107`. `FOOD_TEAM_REMINDER`, `TAKEAWAY_READY` and `LEFTOVERS_READY` are not in `PUSH_TTL`.
- Consequence: a phone that is offline for the evening gets "Takeaway er klar" or "i morgen" the next day.
- Status: INFERRED.

**P2. Live notifications don't refresh madhold pages.**
- Where: `cacheInvalidation.ts:40` only handles `/mad/`, not `/madhold/*` or `/mad`.
- Consequence: someone sitting on `/madhold/bytte` gets the new request marked read but sees no new row. Mine hold stays stale after an accepted broadcast.
- Status: VERIFIED by test (the invalidation half). The auto-mark-read half is from reading.

## Frontend (all P2)

- **A failed fetch says you have no cooking days.** If `teams/my/` fails, Mine hold says "Du er ikke tildelt nogle kommende madhold." (`FoodTeamsPage.tsx:278-282`). VERIFIED.
- **Weekday chips lose a tap.** Two quick taps save only the first. The Ønsker checkboxes race the same way, and their save has no `onError` (`FoodTeamsPage.tsx:3414`, `589`). VERIFIED.
- **A pause reason can be wiped.** Ønsker keeps it in local state loaded once, under another query key than Profil (`539-545` vs `3286`), so a later submit sends `""`. INFERRED.
- **The leftovers upload can time out.** It uses the default 30 s timeout, where forum uploads use 120 s (`api/food.ts:650`). INFERRED.
- **Lists go stale after takeover and broadcast-accept.** They don't invalidate `["food","swap-requests"]`, so cancelled requests still show "Accepter" (`2471`, `3034`). VERIFIED.
- **The Bytte badge counts your own outgoing requests** (`FoodTeamsPage.tsx:195`). VERIFIED.
- **`/madhold/admin` is blank for non-admins.** VERIFIED.

## Resident flags import (`all_persons.csv`, all P2)

- **A missing medbeboer column clears everyone.** "Ønsker at være med medbeboer" is not a required column, so a renamed or missing header sets `prefers_cooking_with_housemate=False` for everyone silently. VERIFIED.
- **Only an exact "1" counts as yes.** `_yes()` treats "1.0", "x" and "TRUE" as no, which clears chefkok or pause. VERIFIED.
- **Unpausing via the sheet keeps the old pause reason.** VERIFIED.
- **A blank house number matches accounts with no house.** VERIFIED.
- **A cp1252-encoded file crashes with a traceback.** It fails safe. VERIFIED.

## Checked and clean

- `local_crontab`: 20:00 local is 18:00 UTC before 25/10 and 19:00 UTC after. Django sets the process `TZ`, so `date.today()` in tasks is Copenhagen time. VERIFIED.
- Notification recipients, texts and links match the go-live table. Side effects run in `on_commit`. Nobody gets both WISHES_OPEN and PAUSE_CHECK. The 48 h nudge window works with the daily 17:30 run.
- Every notification link resolves to the right tab for a non-admin, including from a push click.
- The plan import writes nothing in a dry run, is atomic, and creates 0 notifications. Shell quoting with spaces is fine, and a bare `--replace` is refused.
- Generator: 600 fuzz runs with no crash, no double placement, no same-house pair outside couples, and no team over 7.
- Migration 0029 (takeaway pickup time) doesn't clash with any other branch.

## Prod checks (not run; personal data)

Run them read-only against the 2/10 download (`~/Downloads/db (9).sqlite3`):

```
sqlite3 -readonly "$HOME/Downloads/db (9).sqlite3" "select id,name,status,wish_deadline from food_foodteamcycle; select c.name,count(*),min(t.date),max(t.date) from food_foodteam t join food_foodteamcycle c on c.id=t.cycle_id group by c.id; select id,email,is_staff,is_exempt_from_food_teams from users_user where is_active=1 and house_id is null; select count(*), sum(default_cooking_days not in ('[]','','null')) from users_user where is_active=1 and is_exempt_from_food_teams=0;"
```

Then check the CSV header and encoding:

```
file ~/Desktop/madhold/all_persons.csv; head -1 ~/Desktop/madhold/all_persons.csv
```
