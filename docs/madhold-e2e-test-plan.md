# Madhold (food-team) end-to-end test plan — for a Chrome-equipped agent

This plan drives a **manual, browser-based E2E test** of the launched "Madhold"
(cooking-team) feature on branch `feat/madhold-launch`. It is self-contained:
it tells you how to start the app, how to create test data, which users to log
in as, and exactly what to click and verify for every flow.

The executing agent has Chrome (browser automation) **and** a shell. Use the
shell only for the documented setup/inspection commands — all feature behaviour
must be exercised through the browser, like a real user.

> ALL user-facing text is Danish. Expected strings below are quoted in Danish on
> purpose — match them in the UI.

---

## 0. Key facts (read first)

- **Frontend**: http://localhost:5173  •  **Backend/API/WS**: http://localhost:7000
- **Today is Friday 2026-06-05.** Cooking is **Mon–Thu only**, so there is **no
  natural cooking team today** — the dashboard action box must be created via the
  `spoof_today_food_team` command (Phase 7).
- **Login**: 56 seeded users `*@kb.local`, password **`changeme123`**
  (e.g. `anders.23@kb.local`, `anne.16@kb.local`, `anne-mette.26@kb.local`).
  There is **no admin user with a known password** → Phase 1 creates one.
- **Routes**:
  - `/madhold`, `/madhold/<tab>` where tab ∈ `mine-hold | alle-hold | bytte | oensker | profil | admin`
  - `/mad` (daglig madtilmelding), `/mad/rester` (rester-landingsside), `/mad/praeferencer`
  - Dashboard: `/`
- **Generation finalises the cycle**: after a real (non-dry-run) generation the
  cycle status becomes `finalized` ("Afsluttet") and the Generer/Forhåndsvisning
  buttons disappear for that cycle.
- **DEBUG mode runs Huey tasks synchronously** (`immediate`), so takeaway/leftovers
  notifications and emails are created immediately — recipients can see in-app
  notifications right after the action.
- **Google Drive recipes won't resolve in dev** (no OAuth/credentials). The
  action box's "Dagens opskrifter" / "Åbn opskriftsmappe" section will likely be
  **empty** (errors are suppressed by design). This is expected — verify the box
  still renders members, buttons and counts; do **not** treat a missing recipe
  link as a failure (note it as "Drive not configured in dev").

---

## 1. Setup

### 1.1 Start the app

From the repo root:

```bash
uv run dev.py
```

This starts backend (Daphne, port 7000, with WebSockets) and frontend (Vite, port 5173).
Wait until both are up, then sanity-check:

```bash
curl -s http://localhost:7000/api/health/        # expect 200 / ok
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/   # expect 200
```

If the DB has no users, seed them first (only if needed):
```bash
cd backend && uv run python manage.py seed_users_from_csv   # creates *@kb.local / changeme123
```

### 1.2 Create a known admin test user

The Madhold **Admin** tab only appears for `is_staff` users. Promote one seeded
user to staff and pin a known password so you can log in through the UI:

```bash
cd backend && uv run python manage.py shell -c "
from apps.users.models import User
u = User.objects.get(email__iexact='anders.23@kb.local')
u.is_staff = True
u.set_password('changeme123')
u.save()
print('admin ready:', u.email, 'staff=', u.is_staff)
"
```

> Admin login for the rest of this doc: **`anders.23@kb.local` / `changeme123`**.

### 1.3 Seed a realistic cycle + wishes + generated teams

This builds a 16-day cycle (next 4× Mon–Thu), configures flags, simulates 70%
wishes, and generates teams in one shot:

```bash
cd backend && uv run python manage.py seed_food_teams_test \
    --wish-pct 70 --headchef-pct 20 --couples 4 --over50-pct 15 --unavailable 3 --generate
```

Note the printed cycle name, teams created, and any "Ikke placeret"/warnings.

### 1.4 Build a roster map (which loginable users are on which dates)

Swap/takeover/broadcast flows need you to log in as **specific** team members.
The UI shows names but not emails, so extract the mapping for `@kb.local` users
(the only ones whose password you know):

```bash
cd backend && uv run python manage.py shell -c "
from apps.food.models import FoodTeamMember
rows = (FoodTeamMember.objects
        .filter(user__email__endswith='@kb.local')
        .select_related('user','team')
        .order_by('team__date'))
for m in rows:
    print(m.team.date, '|', m.user.email, '|', m.user.first_name, m.user.last_name, '| house', m.house_number)
"
```

Keep this output. From it pick:
- **User A** and **User B** on **two different dates** (for 1:1 swap + broadcast).
- A **User C** (loginable) on some date you'll **take over** as User A.

Save a short table in your test notes, e.g.:

| Role | Email | First name | Team date |
|------|-------|-----------|-----------|
| A    | …@kb.local | … | YYYY-MM-DD |
| B    | …@kb.local | … | YYYY-MM-DD |
| C    | …@kb.local | … | YYYY-MM-DD |

### 1.5 Multi-user strategy

Several flows need two users acting on the same object (requester + accepter).
Use **two independent browser sessions**:
- Session 1: a normal Chrome window/profile.
- Session 2: an **incognito** window (separate cookie/localStorage jar).

This avoids constant logout/login. Where the plan says "switch to User X", switch
the session that is logged in as that user (or log out and back in if you only
have one session).

---

## 2. Navigation & visibility

1. Log in as **admin** (`anders.23@kb.local`).
2. **Verify the navbar** now shows a **"Madhold"** entry (icon = users-group),
   between "Mad" and "Kalender". (It was previously commented out.) Click it →
   lands on `/madhold`, tab **"Mine hold"** active.
3. Verify the tab bar: **Mine hold, Alle hold, Bytte, Indsend ønsker, Min profil,
   Admin**. The **Admin** tab is present (admin is staff).
4. Open an incognito session, log in as a **regular** user (User A). Confirm the
   Madhold page shows the same tabs **except Admin** (no Admin tab for non-staff).

---

## 3. Admin: cycles & team generation

Logged in as **admin**, open **Madhold → Admin**.

1. **Existing cycle visible**: the seeded cycle appears as a card with status
   badge **"Afsluttet"** (finalized, because we passed `--generate`). It shows
   Madlavningsdage / Ønsker / Hold / Deadline counts. Confirm counts are non-zero
   (Hold ≈ 16, Ønsker > 0).
2. **Create a new cycle** (to test the create + generate flow on a fresh, non-finalized cycle):
   - Click **"Opret periode"**.
   - **Verify auto-prefill**: a blue alert reads **"Forslag: N berettigede kokke →
     M maddage…"** and the form is **pre-filled** — Periodenavn (e.g. *Madhold
     juli-august 2026*), Madlavningsdatoer (M dates = `round(eligible/6)`,
     Mon–Thu, starting **after the last existing cycle**, with closed days
     excluded), and Deadline for ønsker. Confirm M matches `round(N/6)` and that
     no weekend/closed day is in the prefilled set.
   - **Editability**: the multi-date picker still has **weekends and closed days
     disabled**; remove/add a date and tweak the name to confirm the prefill is
     editable (it should not re-fill or clobber your edits while the modal stays open).
   - Click **"Opret periode"** → expect green toast **"Periode oprettet"**, modal
     closes, new card appears with status **"Indsamler ønsker"** and Hold = 0.
   - (Note: the suggested start chains after the latest existing cycle, so the new
     period won't overlap the seeded one.)
3. **Submit some wishes for the new cycle** so generation has data (do this via a
   couple of regular users in Phase 4, OR quickly seed wishes for it):
   - Easiest: in the new-cycle card note there are 0 wishes; generation with 0
     wishes still runs but everyone defaults to "available all dates". You can
     generate directly to test the happy path, but for a realistic run, submit at
     least 1–2 wishes via Phase 4 first, then return here.
4. **Forhåndsvisning (dry-run)**: click **"Forhåndsvisning"** → a result modal
   **"Holdgenerering resultat"** opens. Verify it reports **Hold oprettet: N**,
   lists any **Ikke-tildelte personer** and **Advarsler**. Crucially, after
   closing, the cycle's **Hold count stays 0** (dry-run did not persist) and
   status is still "Indsamler ønsker".
5. **Generer hold (real)**: click **"Generer hold"** → green toast **"Hold
   genereret"**, result modal again. Close it. Verify the card now shows status
   **"Afsluttet"**, Hold > 0, and the Forhåndsvisning/Generer buttons are **gone**
   (cannot regenerate a finalized cycle).
6. **Inspect generated teams** in **Alle hold** (Phase 5) — confirm the new
   cycle's dates now have teams.

> Edge cases to note (not necessarily fail): teams should respect ~6 members
> (overflow 7), ≤2 over-50, ≥1 head chef. The result modal surfaces unassigned
> people / warnings if constraints forced compromises.

---

## 4. Indsend ønsker (wish submission) — regular user

Switch to **User A** (regular). Go to **Madhold → Indsend ønsker**.

1. The active cycle card shows name, **Madlavningsperiode** range, **Deadline**,
   and a green **"Modtager ønsker"** badge (if before deadline). The **"Indsend
   ønsker"** tab should show an **orange "!" badge** when you have not yet
   submitted a wish for an open cycle — verify it's present before submitting.
2. **Standard madlavningsdage**: tick some weekday checkboxes (Mandag/Onsdag).
   Expect green toast **"Standarder gemt"**. (These persist to your profile.)
3. If no existing wish: click **"Anvend standarder til valget nedenfor"** →
   verify the matching dates below become selected (green), button shows
   **"Standarder anvendt"**.
4. **Manually toggle dates**: click a few date cards on/off; the counter
   **"X af Y datoer valgt"** updates. Try **"Vælg alle"** then **"Ryd alle"**.
5. Verify there is **no free-text Kommentar** here while you are available — the
   date cards already say when you can cook. Tick **"Jeg kan ikke i denne
   periode"** and a **"Hvorfor kan du ikke? (valgfri)"** box appears; untick it
   and the box goes away again.
6. Re-select a handful of dates, click **"Indsend ønsker"** → green toast
   **"Ønsker indsendt"**. Reload the tab: a blue alert **"Du har allerede
   indsendt dine ønsker (N datoer valgt)…"** appears, the button reads
   **"Opdater ønsker"**, and the tab's orange "!" badge is **gone**.
7. **Update path**: change the selection, click **"Opdater ønsker"** → toast,
   count updates.
8. **Unavailable toggle**: turn on **"Jeg kan ikke i denne periode"** → date grid
   + defaults grey out (disabled), helper text changes to "Du har markeret, at du
   ikke kan i denne periode". Submit → toast. Reload → switch is still on. Turn it
   back off and re-submit dates to leave a clean state.
9. **Closed-cycle behaviour** (optional): the admin's first seeded cycle is
   finalized/closed; if it surfaces as the active cycle instead, expect the
   yellow alert **"Denne periode modtager ikke længere ønsker…"** and no editable
   grid. (Only one cycle is "active" at a time via `cycles/active/`.)

---

## 5. Min profil (self-service food profile) — regular user

As **User A**, go to **Madhold → Min profil**.

1. Toggle **"Jeg kan være chefkok"** → green toast **"Profil gemt"**. Reload →
   state persisted.
2. Toggle **"Jeg vil lave mad sammen med min medbeboer"**. If User A has a
   housemate, the description shows **"(med <navn>)"**.
3. Toggle **"Jeg er over 50"** → persisted.
4. Toggle **"Jeg holder pause fra madhold"** (red) → persisted, and a
   **"Hvorfor holder du pause?"** box appears below it with a **"Gem
   begrundelse"** button (disabled until the text differs). Save a reason, then
   **turn the switch back off** so A stays eligible for later phases.
5. **Ugedage jeg typisk kan lave mad**: click weekday **Chips** (Mandag…Torsdag)
   → each change saves (toast). Verify selection persists on reload.
6. Verify there is **no standalone "Kommentar til madhold-ansvarlig"** field —
   the only free text here is the pause reason from step 4, which appears only
   while the pause switch is on.

---

## 6. Mine hold / Alle hold (viewing)

1. As **User A**, **Mine hold**: if A is on any generated team, cards appear with
   date, "N holdmedlemmer", **"Anmod om bytte"** + **"Send bytteanmodning"**
   buttons (only for non-past dates). Expand **"Holdmedlemmer"** → avatars, names,
   house numbers; A is bold with **"(Dig)"**. If A is on none, expect the blue
   info alert **"Du er ikke tildelt nogle kommende madhold."** (pick a different
   User A from the roster map if so).
2. **Alle hold**: a compact list of all upcoming teams. Your own team rows are
   highlighted (blue) with a **"Mit hold"** badge. Each shows
   `members_display` + "N medlemmer". **Expand** a row → full member list with
   avatars. Verify there is **no "Overtag" button next to other members** —
   taking someone's shift is offered only where they have asked to be relieved
   (§8.2), not beside every name. Past teams show **"Overstået"** styling.

---

## 7. Dashboard action box + today's-team surfaces

The action box only shows when **you** are on **today's** team. Create one:

```bash
cd backend && uv run python manage.py spoof_today_food_team anders.23@kb.local --others 5
```

This makes a `FoodTeam` dated **today** with the admin + 5 random members.

1. Log in as **admin**, go to **Dashboard (`/`)**.
2. **Action box** at the top: green panel **"Du har madhold i dag 🍳"** with:
   - The team members (avatars + names + "(nr. X)").
   - Recipe section: likely **empty** (Drive not configured) — confirm no crash;
     skeletons resolve to nothing. Note "Drive not configured in dev".
   - **"Takeaway er klar"** (orange) and **"Rester er klar"** (green) buttons.
   - **"Tilmeldinger i dag"** counts (Takeaway / Fælles 17:30 / Fælles 18:30)
     with per-bucket "N personer (P%)" — only renders if there are registrations
     for today with weighted total > 0; may be absent if nobody registered for a
     Friday. Note which case you see.
3. **Food widget subtle line**: scroll to today's **FoodDayWidget** on the
   dashboard → under the menu text, a muted line **"Dagens madhold: <fornavne>"**.
4. **Takeaway flow**: click **"Takeaway er klar"** → green toast **"Takeaway-besked
   sendt"**. Click it **again** → blue toast **"Allerede sendt"** (once-per-day
   guard). Verify a `FOOD_TEAM_TAKEAWAY_READY` notification was created (Phase 9).
5. **Leftovers flow**: click **"Rester er klar"** → an inline panel expands.
   - Type a message, e.g. `Der er lasagne tilbage i køleskabet`.
   - Click **"Vælg billede"**, upload any small image → filename shows.
   - Click **"Send rester-besked"** → green toast **"Rester-besked sendt"**, panel
     collapses. Sending again the same day → blue **"Allerede sendt"**.
6. **Leftovers landing page**: navigate to **`/mad/rester`**. Expect the green
   **"Dagens rester"** page showing **"Der er rester i fælleshuset"**, "Fra dagens
   madhold: …", the message text, the uploaded image, and **"Meldt ud HH:mm"**.
   (Before any leftovers are announced, this page shows the grey alert **"Der er
   ikke meldt rester ud i dag."**)
7. Cleanup when done with this phase (optional):
   `uv run python manage.py spoof_today_food_team anders.23@kb.local --clear`.

---

## 8. Switching shifts — the three mechanisms

Use the roster map (1.4). You need two loginable users (A, B) on **different**
team dates, both non-past.

### 8.1 Bytte (1:1 swap) — `TeamSwapRequest`

1. **User A** → **Mine hold** → on a team card click **"Anmod om bytte"**.
2. In the modal: your date is shown; pick a target date (one of B's dates from the
   list, max 8 shown), then under **"Vælg hvem du vil bytte med"** pick **User B**.
   Add an optional message. Click **"Send anmodning"** → green toast **"Bytte
   anmodet"**.
3. **User A** → **Bytte** tab: under **"Mine anmodninger"** see the outgoing
   request (badge **"Afventer"**) with both dates and an **"Annuller anmodning"**
   button. The **Bytte** tab label shows a **red count badge**.
4. Switch to **User B** → **Bytte** tab → under **"Indgående anmodninger"** the
   request appears ("<A> vil bytte med dig"). Optionally **"Tilføj besked"**.
   Click **"Accepter"** → green toast **"Bytte accepteret"**.
5. Verify the **swap actually happened**: in **Alle hold** (or Mine hold) for both
   users, A is now on B's old date and B on A's old date. Badge counts clear.
6. **Decline path** (repeat with another pair or re-create): create a new request,
   as the recipient click **"Afvis"** → orange toast **"Bytte afvist"**, no
   membership change.
7. **Cancel path**: create a request as A, then as A click **"Annuller anmodning"**
   → blue toast, it leaves the pending list.

### 8.2 Overtag (takeover / favour) — `TeamTakeover` + `TeamFavour`

Takeover is offered only where someone has asked to be relieved, or where it
settles a debt — never beside every name on every team.

1. As **User C**, send a **broadcast bytteanmodning** for one of C's shifts
   (§8.3 covers the form). As **User A**, open **Bytte** → the incoming card.
2. If A holds none of C's offered dates, the card says A cannot swap, and offers
   **"Jeg tager den (de skylder dig en)"**. If A does hold one, the takeover is
   the secondary action under the swap: **"Eller tag den uden at bytte"**.
3. Click it → confirm modal **"Overtag maddag"** explains C will owe A a favour
   → **"Overtag maddagen"** → green toast "Maddag overtaget. <C> skylder dig nu
   en tjeneste."
4. Verify membership: that team now lists **A** instead of **C** (A may now have
   two shifts that cycle — allowed).
5. **Favour ledger** — **User A** → **Bytte** tab → **"Tjeneste-regnskab"** →
   under **"Nogen skylder mig"**: "<C> skylder dig en tjeneste · Fra maddag d. …".
6. Switch to **User C** → **Bytte** → **"Tjeneste-regnskab"** → under **"Jeg
   skylder"**: "Du skylder <A> en tjeneste".

### 8.2b Indfri en tjeneste ved at lave mad

1. Still as **User C** (who owes A), open **"Tjeneste-regnskab"** → **"Jeg
   skylder"** → click **"Indfri med en maddag"**.
2. The modal lists **A's upcoming shifts**, minus any day C already cooks (those
   would double-book C). If A has none, expect the empty-state text.
3. Pick one → **"Tag denne dag"** → confirm → toast "Du har taget <A>s maddag.
   Tjenesten er nu udlignet."
4. Verify: that shift now belongs to **C**; the favour moves to **Indfriet** for
   both parties; and **no new favour** was created in C's name.

### 8.2c Beboeroverblik (food admin)

1. As a **food admin**, open the **Admin** tab. The top section is
   **Beboeroverblik**, headed by the period the answers belong to.
2. Verify four groups: **Holder pause** (with reasons), **Ikke med i denne
   periode** (with reasons), **Kan være chefkok**, **Vil lave mad med
   medbeboer** — each with a count.
3. Set a pause + reason on some user (§5) and confirm they move into **Holder
   pause** with that reason showing. Mark another user unavailable for the
   period (§4) with a reason → they appear under **Ikke med i denne periode**.
4. As that second user, submit a normal wish for a later period → their reason
   clears. Do the same for the paused user → their reason **stays**, because
   the pause outlives the period.
5. Confirm a non-admin gets no Admin tab (the endpoint returns 403).
6. **Settle**: as **User A** click **"Markér som indfriet"** on the favour →
   green toast **"Tjeneste indfriet"**, badge becomes **"Indfriet"**. Verify it
   shows as Indfriet for C too.

### 8.3 Broadcast bytteanmodning — `SwapBroadcast`

1. **User A** → **Mine hold** → on a team card click **"Send bytteanmodning"**.
2. Modal **"Send bytteanmodning til alle mulige byttere"**: in **"Datoer jeg i
   stedet kan tage"** select one or more dates that **User B currently cooks**
   (so B becomes a candidate). Optionally add a message.
3. Click **"Send bytteanmodning"**:
   - If candidates exist → green toast **"Bytteanmodning sendt … Sendt til N
     mulige byttere."**
   - If none → orange toast **"Ingen mulige byttere fundet"** (then test the forum
     fallback below). To force candidates, choose dates where you know a loginable
     user cooks (from the roster map) and who indicated availability for **your**
     date (via wish or default cooking days). If matching is finicky, you can still
     verify the "no candidates" path + forum share.
4. **User A** → **Bytte** tab → **"Mine udsendte anmodninger"** → card with badge
   **"Åben"**, the offered dates, and an **"Annullér"** button.
5. Switch to **User B** → **Bytte** tab → **"Bytteanmodninger til dig"** → card
   "<A> vil bytte sin maddag …". Pick one of **your** maddage in **"Vælg hvilken
   af dine maddage du giver i bytte"** → click **"Accepter byt"** → green toast
   **"Byt accepteret"**.
6. Verify the swap occurred (memberships exchanged between A and B on those dates).
7. **Closed-broadcast visibility** (regression from the launch doc): with a
   broadcast that had **multiple** candidates, after one accepts, switch to a
   **different** candidate's session and open **Bytte** → the broadcast still
   appears but shows the grey alert **"Allerede accepteret af <navn>. Du behøver
   ikke gøre noget."** (it is **not** hidden). Cancelled broadcasts show
   **"Anmodningen er trukket tilbage."** The **Bytte** badge only counts truly
   open/actionable ones.
8. **Cancel path**: as **User A**, on an **open** outgoing broadcast click
   **"Annullér"** → blue toast; recipients see "trukket tilbage".
9. **Share to Fælles-forum**: reopen **"Send bytteanmodning"**, optionally pick
   dates/message, click **"Del i Fælles-forum"** → toast **"Klar i
   Fælles-forummet"**, you are navigated to **`/forum/<faelles-slug>`**. Click
   **"Ny tråd"** → verify the **title** ("Bytte af maddag <dato>") and **body**
   (pre-filled Danish text mentioning your date + offered dates) are **prefilled
   from the draft**. (You don't have to actually post it.)

---

## 9. Notifications: inbox, red dot, preferences

### 9.1 Notification preferences page

As any user, go to **notification settings** (gear / "Notifikationsindstillinger"
— reachable from the user menu; route renders `NotificationPreferencesPage`).

1. Verify settings are **grouped** into categories: **Beskeder, Forum, Vigtige
   opslag, Arrangementer, Mad** (the flat ~30 switches are grouped).
2. Open the **Mad** group → verify rows:
   - **Madbilletter**
   - **Påmindelse om madhold** — "Få besked aftenen før du har madhold"
   - **Takeaway er klar** — "Få besked når dagens takeaway kan afhentes"
   - **Rester er klar** — "Få besked når der er rester i fælleshuset"
   Each row has the relevant channel toggles (in-app / email / push).
3. Toggle one (e.g. turn **Takeaway er klar** in-app off then on) → verify it
   saves (persists on reload).
4. **Defaults note**: per the design, `food_team_reminder` defaults ON for
   everyone; `food_takeaway_ready` defaults ON for take-away users;
   `food_leftovers_ready` defaults ON for the 17:30 crowd. Spot-check that a
   freshly seeded user's defaults look sensible (not all-off).

### 9.2 In-app notifications + red dot

1. Trigger a community notification: in Phase 7 you sent **Takeaway** and
   **Rester** messages. Log in as a **different** user who has the relevant
   preference enabled.
2. Verify the **navbar bell / red dot** indicates unread notifications.
3. Open **Notifikationer** (`NotificationsPage`) → verify entries for **"Takeaway
   er klar"** and **"Rester er klar"** (teal kitchen icon). Clicking the leftovers
   one should navigate to **`/mad/rester`**.
4. (If you can wait/trigger it) the **day-before reminder** (`food_team_reminder`)
   is a 20:00 periodic task — not practical to trigger live; just confirm the
   preference + notification type exist. You may invoke the task manually to
   verify wiring:
   ```bash
   cd backend && uv run python manage.py shell -c "
   from apps.food.tasks import send_food_team_reminders
   send_food_team_reminders()  # immediate mode runs synchronously
   "
   ```
   Then check recipients' inboxes for **"Påmindelse om madhold"** (only fires if
   someone cooks the next cooking day).

---

## 10. Permissions / negative checks

1. As a **regular** (non-staff) user, confirm there is **no Admin tab** and a
   direct visit to **`/madhold/admin`** does **not** render the admin panel
   (falls back / hidden). Generation endpoints are food-admin gated server-side.
2. As a user **not** on today's team, the **dashboard action box is absent**
   (self-hides).
3. Try sending takeaway as a user not on today's team via the UI — there is no
   button for them, but if you craft the call you should get 403 "Kun medlemmer
   af dagens madhold…". (UI-level: simply confirm the button only exists for
   members.)

---

## 11. Wrap-up & reporting

Produce a concise report:

- ✅/❌ per phase (2–10) with the specific Danish strings/toasts you observed.
- Screenshots of: navbar with Madhold, Admin cycle cards, wish submission, Min
  profil, a generated team in Alle hold, the dashboard action box, `/mad/rester`,
  the Bytte tab (swap + favour + broadcast states), and the Mad notification group.
- Any console errors (open DevTools console while testing) or failed network
  requests (Network tab → red entries).
- Explicitly flag: Drive recipe section behaviour in dev, any generator warnings /
  unassigned persons, and anything that crashed or showed an English string
  (English in UI = bug, since all user-facing text must be Danish).
- Note any state you left dirty (e.g. spoofed today-team) and whether you cleared it.

### Reset helpers (optional, between runs)

```bash
cd backend && uv run python manage.py shell -c "
from apps.food.models import FoodTeamCycle, FoodTeam, FoodTeamWish, TeamSwapRequest, SwapBroadcast, TeamFavour
for M in (TeamFavour, SwapBroadcast, TeamSwapRequest, FoodTeam, FoodTeamWish, FoodTeamCycle):
    print(M.__name__, M.objects.all().delete())
"
# then re-run 1.3 to reseed.
```
(There is no separate takeover model — a takeover reassigns a `FoodTeamMember`
and records a `TeamFavour`. Deleting teams/favours resets it.)
</content>
</invoke>
