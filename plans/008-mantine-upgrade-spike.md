# Plan 008: Spike — assess upgrading Mantine off 9.0.0-alpha.1

> **Executor instructions**: This is an INVESTIGATION plan. The primary
> deliverable is a written report appended to this file under "## Spike
> findings"; an actual upgrade commit happens ONLY if every gate in Step 4
> passes. Follow steps in order, run every verification command, and honor the
> STOP conditions. When done, update the status row in `plans/README.md` —
> unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 023ad2c..HEAD -- frontend/package.json frontend/src/utils/scheduleHelpers.ts frontend/src/pages/BookingsPage.tsx frontend/src/pages/CalendarPage.tsx`
> If package.json's Mantine pins changed since planning, STOP — someone
> already did this.

## Status

- **Priority**: P2
- **Effort**: M (spike; the upgrade itself may be S or may be rejected)
- **Risk**: MED — alpha→stable can break APIs the app relies on
- **Depends on**: plan 002 (lands first; both touch `frontend/package.json`)
- **Category**: dependencies
- **Planned at**: commit `023ad2c`, 2026-06-12

## Why this matters

All nine Mantine packages are pinned to `9.0.0-alpha.1` (`frontend/package.json:21-29`). Alphas receive no security or bug fixes, and the app carries documented workarounds for alpha bugs: `expandMultiDayEvents` in `frontend/src/utils/scheduleHelpers.ts` (≈45 lines + a long rationale comment) papers over two `@mantine/schedule` multi-day rendering bugs, and `CalendarPage.tsx:491` notes "Workaround: @mantine/schedule alpha doesn't destructure onTimeSlotClick". If a stable 9.x has shipped since the pin, upgrading removes risk and possibly the workarounds; if not, the spike documents that and sets a re-check date. Either outcome is valuable; an unexamined alpha pin in production is not.

## Current state

- `frontend/package.json:21-29` — `@mantine/{carousel,core,dates,dropzone,hooks,notifications,schedule,spotlight,tiptap}` all exactly `"9.0.0-alpha.1"` (no caret).
- `frontend/src/utils/scheduleHelpers.ts:~50-100` — `expandMultiDayEvents` with a docstring naming the two alpha bugs precisely:
  - Month grid: events packed into week-global rows, only first two rendered, day fully covered by multi-day events renders blank while showing "+N more".
  - Day view: `getDayViewEvents` only includes events that *start* on the viewed day, so overnight bookings vanish from day 2.
  - Plus a midnight-end clamp (end at 00:00:00 belongs to the previous day).
- Consumers: `BookingsPage.tsx` (line 54 imports it; line 200 applies it conditionally per view) and `CalendarPage.tsx` (uses `Schedule` directly, plus the `onTimeSlotClick` workaround at line 491).
- The Schedule component renders the booking calendar — recently the app's highest-churn feature (multiple "fix multi day event booking" commits).

## Commands you will need

| Purpose | Command (from `/frontend`) | Expected on success |
|---|---|---|
| What's published | `npm view @mantine/schedule versions --json \| tail -20` and `npm view @mantine/core dist-tags` | see latest stable/tags |
| Changelog | fetch `https://github.com/mantinedev/mantine/releases` (WebFetch/WebSearch if available) | release notes for 9.x |
| Upgrade (if green-lit) | `npm install @mantine/core@<target> @mantine/carousel@<target> ...` (all nine, same version) | exit 0 |
| Gates | `npm run typecheck && npm run lint && npm run format:check && npm run test:run && npm run build` | all exit 0 |

## Scope

**In scope**: `frontend/package.json`, `frontend/package-lock.json`, and — only if the upgrade lands AND the bugs are verified fixed — `frontend/src/utils/scheduleHelpers.ts`, `BookingsPage.tsx`, `CalendarPage.tsx` workaround removal. Plus the "Spike findings" section of this file.

**Out of scope**:

- Any other dependency.
- Removing `expandMultiDayEvents` without the Step 5 verification — the workaround also encodes the midnight-clamp behavior that may be correct regardless of library fixes.
- Mantine 10/major redesigns if such exist — this spike targets the nearest stable 9.x only.

## Git workflow

- Branch: `advisor/008-mantine-upgrade-spike`
- If the spike concludes "don't upgrade": commit ONLY the findings appended to this plan file.
- If it concludes "upgrade": separate commits — `chore: mantine 9.0.0-alpha.1 -> <version>` then (only if verified) `refactor: drop schedule multi-day workaround fixed upstream`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Establish what exists upstream

`npm view @mantine/core versions --json | tail -30` and the same for `@mantine/schedule` (it may have a separate release cadence — it's newer than the core packages). Record: latest stable 9.x of each of the nine packages, and whether `@mantine/schedule` has ANY stable release. If `@mantine/schedule` is still alpha/beta-only, the app cannot leave alpha for that package; record the latest alpha and check its changelog for the two bugs.

### Step 2: Check the two known bugs upstream

Search the Mantine repo issues/releases (WebSearch/WebFetch if available; otherwise the changelog from `npm view @mantine/schedule` and the GitHub releases page) for fixes matching: month-grid row-packing blanking fully-covered days, and day view omitting events that span into the day. Record issue/PR links or "not found".

### Step 3: Write the verdict

Append `## Spike findings` to this file: versions found, bug status, recommendation (upgrade to X / stay pinned, re-check on DATE / upgrade core but keep schedule alpha — note that Mantine requires matching major versions across its packages, so mixed-version setups need checking against the docs). If the verdict is "stay pinned", mark the plan DONE in `plans/README.md` with that one-liner and stop here.

### Step 4: Upgrade (only if Step 3 says so)

Install the target version for all nine packages in one command. Then run all five gates (`typecheck`, `lint`, `format:check`, `test:run`, `build`). Fix only mechanical breakages (renamed props/imports) — if a component's behavior model changed (e.g. Schedule's event API reshaped), STOP and report.

**Verify**: all five commands exit 0.

### Step 5: Re-evaluate the workarounds (only after Step 4 passes)

The frontend test suite covers schedule helpers (`grep -ln expandMultiDayEvents frontend/src --include="*.test.*" -r` to find the tests). For workaround removal you must ALSO verify visually: run the dev server (`npm run dev` with the backend up via `uv run dev.py` from repo root), create a multi-day booking spanning ≥3 days, and check (a) month view shows it on every covered day with no blank cells, (b) day view shows it on its second day, (c) a booking ending exactly at midnight doesn't spill a chip onto the next day. If and only if all three hold without `expandMultiDayEvents`, remove it, its call sites, and the `onTimeSlotClick` workaround if also fixed. If you cannot run the app visually in your environment, leave the workarounds in place and note that in the findings — they are harmless when the underlying bugs are fixed.

**Verify**: gates again, plus `npm run test:run` green after any helper removal (update its unit tests accordingly — midnight-clamp tests may need to move into the booking-mapping code if that behavior must survive).

## Test plan

The existing Vitest suite (notably the scheduleHelpers tests) plus the five gates. No new tests unless the workaround is removed — then the midnight-boundary behavior needs a preserved home and test.

## Done criteria

- [ ] `## Spike findings` appended to this file with versions, bug status, and a recommendation
- [ ] If upgraded: all five frontend gates exit 0, and Mantine entries in package.json share one stable version
- [ ] If workarounds removed: visual checklist in Step 5 documented as performed, with results
- [ ] `plans/README.md` status row updated (DONE with verdict one-liner)

## STOP conditions

- `@mantine/tiptap` or `@mantine/schedule` has no release compatible with the chosen core version.
- Step 4 gate failures that require non-mechanical code changes.
- The visual check in Step 5 fails any of its three cases — keep the workaround, record the result, finish the spike as "upgrade yes, workaround stays".

## Maintenance notes

- If the verdict is "stay pinned": set a re-check (the memory note `mantine-schedule-alpha-multiday` tracks this); alphas should not survive in production indefinitely.
- If upgraded: watch the booking calendar closely for the first week — month-view rendering regressions were historically reported by residents (23 Jun / Aug Sundays 2026 per the workaround comment).
