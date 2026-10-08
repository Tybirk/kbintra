# Madhold launch on prod, 2026-10-08

Runbook: `docs/madhold-go-live.md`. Everything below is verified (how in brackets).

## Done

1. **develop → main**, CI run 37754296467 green for be931f3.
2. **Pre-check on prod** (sqlite3 -readonly): no `food_foodteamcycle` rows; 12–15/10
   are all `ClosedFoodDay`.
3. **Deploy** `./deploy.sh` at 09:13 UTC. All four app containers on
   `be931f33d7c1…` (docker ps), food 0029/0030 and forum 0053 applied (showmigrations),
   `/api/health/` ok. Pre-deploy backup `data/backups/db-2026-10-08-091322.sqlite3`.
   Rollback: `git checkout deploy-20261008-091321 && IMAGE_TAG=$(git rev-parse HEAD) docker compose pull && docker compose up -d`.
4. **Plan dry run**: all 89 names resolved, 14 interpreted. Each interpreted match
   checked against every resident of that house on prod: the match is the only
   resident fitting the name (no moved-out mismatches).
5. **Plan import**: cycle 1 "Madhold september/oktober 2026", finalized, 15 teams
   17/9–20/10, 89 members (sqlite count). `/api/food/teams/` as staff returns the
   three upcoming teams 8/10, 19/10, 20/10 with 6 cooks each.
6. **Resident settings dry run**: 105 matched, 16 change (6 to pause, Isla off pause,
   Asger + Christina stop cooking with housemate, rest pause reasons). No chefkok
   cleared, no "medbeboer → False" flood, no `OBS … står på holdet` lines.
7. **Resident settings applied**: "Gemt for 16 beboere." 16 active residents on pause.
8. **Silent**: zero `notifications_notification` rows created since the deploy.

## Not done / not verified

- UI check (menu entry, Alle hold, Beboeroverblik) in a browser: the browser
  extension was not connected. Verified only via the frontend source (`TRIAL_ONLY_PATHS = []`)
  and the API.
- Announcement in Vigtige opslag: drafted, not posted (goes out in the maintainer's name).
- Reminders: tonight 20:00 logs `No food team cooking on 2026-10-09` (Friday). The first
  real reminder is **Sunday 18/10 20:00** for Monday 19/10 (6 cooks + housemates);
  check Dozzle for `Sent 6 food team reminders`.

## Next period (manual, in the app)

- By ~12/10: Mad → Admin → "Opret periode" (suggests start 21/10, wish deadline
  19/10 23:59). Opening notifies about 90 residents.
- 20/10 before 20:00: "Generer hold" and confirm, so 21/10's cooks get their reminder.
