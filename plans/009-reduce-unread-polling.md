# Plan 009: Slow the unread-count polling now that WebSocket invalidation exists

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 023ad2c..HEAD -- frontend/src/components/AppHeader.tsx frontend/src/components/AppNavbar.tsx`
> On mismatch with the excerpts below, STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: MED-LOW — the forum unread count has no WS push; mitigated by keeping a slow poll rather than removing it
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `023ad2c`, 2026-06-12

## Why this matters

Five React Query subscriptions poll unread-count endpoints every 30 seconds for every open tab: two in `AppHeader.tsx` (notifications + messages) and three in `AppNavbar.tsx` (messages + notifications + forum). With ~90 residents and PWA tabs left open, that's a steady ~10 requests/minute/user of mostly-redundant load and mobile battery drain — redundant because `AppHeader` already invalidates these exact query keys from the WebSocket (`new_notification` handler and on-reconnect invalidation are in place). The conservative fix: keep polling as a fallback but at 5 minutes, letting the WS path do the real-time work. This is deliberately NOT a removal — the forum unread count (`["forum", "unread-count"]`) has no WS invalidation today, and `refetchOnWindowFocus` (React Query default: on) plus the slow poll keeps it fresh enough for a navbar badge.

## Current state

`frontend/src/components/AppHeader.tsx` (~lines 64-78):

```tsx
  const { data: unreadNotificationsData } = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: notificationsApi.getUnreadCount,
    refetchInterval: 30000, // Refetch every 30 seconds
  })

  const { data: unreadMessagesData } = useQuery({
    queryKey: ["messages", "unread-count"],
    queryFn: messagingApi.getUnreadCount,
    refetchInterval: 30000, // Refetch every 30 seconds
  })
```

Directly below (~lines 85-115), the WS effect: `chatWs.connect()`, `chatWs.onConnectionChange` invalidates both `["notifications","unread-count"]` and `["messages","unread-count"]` on reconnect, and `chatWs.onMessage` invalidates `["notifications","unread-count"]` + `["notifications"]` on `new_notification` (and handles message events further down — read the full handler before changing anything).

`frontend/src/components/AppNavbar.tsx` (~lines 92-118): three `useQuery` blocks with `refetchInterval: 30000` for `["messages","unread-count"]`, `["notifications","unread-count"]`, `["forum","unread-count"]`.

Note: header and navbar share query keys for messages/notifications, so React Query deduplicates — the *effective* current poll cadence per tab is 30s × 3 distinct keys. The fix still applies to all five call sites so no component pins the fast interval.

Conventions: oxlint/oxfmt; comments in English; no inline object types inside generics (CLAUDE.md rule).

## Commands you will need

| Purpose | Command (from `/frontend`) | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint + format | `npm run lint && npm run format:check` | exit 0 |
| Tests | `npm run test:run` | all pass |
| Confirm no 30s polls remain | `grep -rn "refetchInterval: 30000" src/components/AppHeader.tsx src/components/AppNavbar.tsx` | no matches |

## Scope

**In scope**: `frontend/src/components/AppHeader.tsx`, `frontend/src/components/AppNavbar.tsx`, and a new shared constant file IF one doesn't exist (check `frontend/src/config.ts` first — it exists; put the constant there).

**Out of scope**:

- The WebSocket layer (`frontend/src/api/messaging.ts`) and its handlers — no changes.
- Other `refetchInterval` uses elsewhere in the app (`grep -rn refetchInterval frontend/src` will show them; touch only the five listed).
- Backend unread-count endpoints.
- Adding WS push for forum unread counts (see Maintenance notes — deferred).

## Git workflow

- Branch: `advisor/009-reduce-unread-polling`
- One commit: `perf: unread-count polling 30s -> 5min (WS invalidation is primary)`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a named constant

In `frontend/src/config.ts`, add:

```ts
// Fallback polling for unread badges. Real-time updates come over the
// WebSocket (AppHeader invalidates the query keys); this only catches
// missed events and the forum count, which has no WS push.
export const UNREAD_FALLBACK_REFETCH_MS = 5 * 60 * 1000
```

### Step 2: Apply it at all five call sites

In `AppHeader.tsx` (2 sites) and `AppNavbar.tsx` (3 sites), replace `refetchInterval: 30000` and the trailing comment with `refetchInterval: UNREAD_FALLBACK_REFETCH_MS,` and import the constant. Do not change query keys, queryFns, or anything in the WS effect.

**Verify**: `grep -rn "refetchInterval" src/components/AppHeader.tsx src/components/AppNavbar.tsx` → 5 hits, all using the constant.

### Step 3: Gates

`npm run typecheck && npm run lint && npm run format:check && npm run test:run` → all exit 0. Existing header/navbar tests (`AppHeader`/`AppNavbar` have co-located or page-level tests — `grep -ln "unread" frontend/src -r --include="*.test.tsx" | head`) must pass unchanged.

## Test plan

No new tests — the change is a constant swap; behavior (badge values, query keys) is covered by existing component tests. Manual sanity (optional, if dev env available): open two browser sessions, send a message from one, confirm the other's badge updates within ~1s (WS path, unchanged).

## Done criteria

- [ ] `grep -rn "refetchInterval: 30000" frontend/src/components/` → no matches
- [ ] All four frontend gates exit 0
- [ ] `git diff --stat` touches only the three in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

- The AppHeader WS effect does NOT invalidate `["messages","unread-count"]` anywhere in the `onMessage` handler for incoming messages (read the full handler — if message badges rely solely on polling, the message-count interval must stay fast; report instead of slowing it).
- Component tests assert on the 30s interval explicitly.

## Maintenance notes

- The forum unread badge now updates on navigation/focus/5-min poll only. If residents complain it's stale, the right fix is a WS `forum_activity` event invalidating `["forum","unread-count"]` — not restoring fast polling.
- If a future feature adds another unread badge, use `UNREAD_FALLBACK_REFETCH_MS` and WS invalidation, not a new fast poll.
