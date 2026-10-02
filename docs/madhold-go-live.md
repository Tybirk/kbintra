# Madhold go-live (October 2026)

Written 2026-10-02 at `origin/develop` 00dde7d. Covers whether madhold is ready, every
notification it sends, and how to load the September–October plan
(`madhold-september-oktober-2026.pdf`) into prod.

## Verdict: ready, once the plan is imported and the menu entry ships

- **Code is on prod already.** Only the nav entry is hidden there (`TRIAL_ONLY_PATHS`
  in `AppNavbar.tsx`). The routes, API, dashboard action box and every periodic task
  below are live today.
- **Tests:** `uv run pytest apps/food apps/notifications`: 357 passed (2026-10-02, on `main`).
- **The plan resolves.** A dry run of the PDF against the June residents snapshot
  (`backend/db.sqlite3`) matched all 89 names uniquely (re-checked against the 2/10 prod download: same result), 14 of them by interpretation
  (a spelling variant, initials, a shortened first name, the first word of a double
  first names). A real import into a scratch copy created 15 teams / 89 cooks.
- **First notification residents will get:** Sunday 4/10 20:00, the reminder for
  Monday 5/10. Simulated on the scratch copy: 6 cooks + 5 housemates = 11 notifications.

**Importing teams is the launch.** The day-before reminder links to `/madhold/mine-hold`
and fires for whoever is on tomorrow's team, menu entry or not. Ship the menu change
the same day as the import, before Sunday 20:00.

## Launch sequence

1. Dry run against prod (it writes nothing, but copies the file to the server):
   `KBINTRA_HOST=<prod ssh target> ./import-madhold.sh ~/Downloads/madhold-september-oktober-2026.pdf`
   Expect `Alle 89 navne blev slået entydigt op.` If a name fails, someone has moved
   or been renamed since June. Fix the resident in admin (or the text) and re-run.
2. Import: same command plus `--apply`. If it says
   `Der findes allerede hold på N af datoerne`, prod has teams on those dates already
   (e.g. a generated test cycle). Re-run with `--apply --replace`. This deletes those
   teams **and their swap requests/broadcasts** (cascade).
2b. Resident settings from the organiser's sheet (`~/Desktop/madhold/all_persons.csv`):
   `KBINTRA_HOST=<prod> ./import-madhold.sh ~/Desktop/madhold/all_persons.csv`, then `--apply`.
   Sets pause + reason, chefkok, medbeboer (and over 50 for the two residents without a
   birthdate). Against the 2/10 prod download: 105 rows matched, 16 residents change.
   6 residents go on pause, 1 comes off it (and is on an upcoming team, as the plan
   expects), 2 stop cooking with their housemate, and the rest only get a pause reason.
   5 current residents are not in the sheet (moved in since it was made) and are left
   as they are. Nobody being paused has an upcoming day (the command warns if they do).
3. Merge + deploy the PR that removes `/madhold` from `TRIAL_ONLY_PATHS`.
4. Post the announcement in Vigtige opslag. The import is silent on purpose (see below).
5. Watch Sunday 4/10 20:00 in Dozzle: `Sent 6 food team reminders (+5 household) for 2026-10-05`.

Undo: re-run the import with a corrected file and `--replace`. In-app "Slet hold og åbn perioden igen"
refuses here because 17/9–1/10 have passed. Delete the cycle in Django admin to remove
it entirely (cascades teams + members).

### What the import does and does not do

- Creates (or, by name, updates) cycle **Madhold september/oktober 2026**, status
  Afsluttet, 15 teams. The 9 past dates (17/9–1/10) are stored as history and hidden
  everywhere, because every team list is upcoming-only.
- Sends **nothing**. It does not fire `FOOD_TEAM_PLAN_READY`. That task lists every
  day in the cycle, so cooks of 17/9–1/10 would get "Dine maddage" for days already
  cooked. The plan is on the noticeboard already, so the announcement does that job.
- Does not check constraints (team size, over-50, housemates): the plan was decided
  outside the app. One team has 5 cooks, and one has two cooks from the same house.
- Next period: "Opret periode" suggests dates from 21/10, the day after this cycle's
  last date (`cycle_planning.suggested_start_date`). Week 42 (12–15/10) has no teams.
  Check those days are `ClosedFoodDay`s on prod, otherwise registrations open with no
  cooks (inferred from the PDF gap, not checked on prod).

### Test server

Same script with `REMOTE_DIR=/opt/kbintra-test2` and the test host. `deploy-test.sh`
replays `data/madhold-import.txt` after every prod-DB copy. **Caution:** the test
server runs Huey with live e-mail and prod addresses. With the roster staged there,
anyone with e-mail on for "Påmindelse om madhold" gets each 20:00 reminder twice.
Push is isolated on staging (its own VAPID keys). Stage it only for a short test, then
delete `data/madhold-import.txt` on the test host.

## Every madhold notification

Channels: **in-app / e-mail / push**. "Toggle" = a row in Notifikationsindstillinger →
Mad. Model defaults for toggled types: in-app on, e-mail **off**, push on. Migration
`0017_derive_food_notification_defaults` turned takeaway on only for houses that order
take-away, and leftovers only for the 17:30 crowd. That applied to residents existing
at the time; anyone created since gets the model default (on).

| Type | When | Who | Toggle | Link |
|---|---|---|---|---|
| `FOOD_TEAM_REMINDER` "Du har madhold i morgen" | Daily 20:00 (local), for tomorrow's team | Each cook | Påmindelse om madhold | `/madhold/mine-hold` |
| `FOOD_TEAM_REMINDER` "Anna har madhold i morgen" | Same run | Rest of each cook's house, minus anyone also cooking | same toggle | `/madhold/mine-hold` |
| `FOOD_TEAM_TAKEAWAY_READY` | Cook taps "Takeaway er klar" (once per team), "Nu" or an advance time before 17:30 ("Takeaway klar kl. 17:15") | Houses with a take-away registration that day, minus the team | Takeaway er klar | `/mad` |
| `FOOD_TEAM_LEFTOVERS_READY` (+ photo in e-mail) | Cook taps "Rester er klar" (once per team) | Houses on take-away or eat-in 17:30, minus the team | Rester er klar | `/mad/rester` |
| `FOOD_TEAM_SWAP_REQUEST` "Bytteanmodning til madhold" | Broadcast sent | Candidates: available on the date (wish or standing weekdays) and cooking one of the offered dates | Bytteanmodninger | `/madhold/bytte` |
| `FOOD_TEAM_SWAP_REQUEST` | 1:1 bytte requested | The target | same | `/madhold/bytte` |
| `FOOD_TEAM_SWAP_REQUEST` "Dit bytte er accepteret/afvist" | 1:1 answered | The requester | same | mine-hold / bytte |
| `FOOD_TEAM_SWAP_REQUEST` "Din bytteanmodning er accepteret" | A candidate accepts a broadcast | The broadcaster | same | `/madhold/mine-hold` |
| `FOOD_TEAM_SHIFT_TAKEN` "Din maddag er overtaget" | Someone takes your day (overtag / repay favour) | The previous owner | none | `/madhold/bytte` |
| `FOOD_TEAM_PLAN_READY` "Dine maddage: …" | Admin's real "Generer hold" (not dry run, not import) | Each cook, one message for all their days | none | `/madhold/mine-hold` |
| `FOOD_TEAM_WISHES_OPEN` "Der er åbnet for madholdsønsker" | Admin creates a period | Everyone not on pause | none | `/madhold/oensker` |
| `FOOD_TEAM_PAUSE_CHECK` "Holder du stadig pause?" | Admin creates a period | Everyone on pause (instead of the above) | none | `/madhold/profil` |
| `FOOD_TEAM_WISHES_OPEN` "Husk dine madholdsønsker" | Daily 17:30, once per period, 24–48 h before the deadline | Participants without a wish | none | `/madhold/oensker` |

The no-toggle types are always in-app. They go by e-mail/push to anyone who has *any*
e-mail/push channel on (`has_any_email_channel` / `has_any_push_channel`). Each fires a
few times a year and carries something you can't learn in time any other way.
`apps/food/test_madhold_notifications.py` pins each one down.

The next opening ("Opret periode" for November) is the first time the whole house gets
a madhold notification at once: about 90 in-app, plus e-mail and push behind them.

## Not verified

- Name resolution against **today's** prod residents. The check used the June snapshot.
  The newer local copy (`data/db.sqlite3`, 9/9) is malformed (`malformed database
  schema (Spisesal)`). Step 1's dry run on prod covers this.
- E-mail and push delivery on prod. Locally: locmem e-mail, no VAPID keys.
- `import-madhold.sh` was run with stubbed `ssh`/`scp` (commands checked, file
  content checked by importing it locally), not against a real host.
- Recipe links in the action box depend on Google Drive on prod. They are empty in dev
  by design.
