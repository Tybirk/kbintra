# Plan 002: Fix known frontend dependency vulnerabilities (axios HIGH + 4 moderate)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 023ad2c..HEAD -- frontend/package.json frontend/package-lock.json`
> If these changed since this plan was written, re-run `npm audit --omit=dev`
> and re-scope to whatever it currently reports; if it reports zero
> vulnerabilities, mark this plan DONE-already and stop.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (semver-compatible bumps; axios is the only direct dep affected)
- **Depends on**: none — but must land BEFORE plan 008 (Mantine spike), which also touches package.json
- **Category**: security
- **Planned at**: commit `023ad2c`, 2026-06-12

## Why this matters

`npm audit --omit=dev` (run 2026-06-12) reports **5 vulnerabilities (1 high, 4 moderate)**, all with fixes available via `npm audit fix` (i.e. semver-compatible):

- **axios ≤1.15.2 — HIGH** (direct dependency, currently `^1.13.2` at `frontend/package.json:41`): a cluster of advisories incl. NO_PROXY SSRF bypasses, prototype-pollution gadgets (request hijacking, header injection, XSRF-token leakage), CRLF injection, ReDoS. Axios is the app's entire API client (`frontend/src/api/client.ts`).
- **react-router 6.7.0–6.30.3 — moderate** (via `react-router-dom ^6.30.2` at `package.json:50`): open redirect when a same-origin redirect path starts with `//` (GHSA-2j2x-hqr9-3h42).
- **follow-redirects ≤1.15.11 — moderate** (transitive): leaks custom auth headers to cross-domain redirect targets.
- **markdown-it 13.0.0–14.1.0 — moderate** (transitive): ReDoS (GHSA-38c4-r59v-3vqw).

## Current state

- `frontend/package.json:41` — `"axios": "^1.13.2"`
- `frontend/package.json:50` — `"react-router-dom": "^6.30.2"`
- `follow-redirects` and `markdown-it` are transitive (not in package.json dependencies).
- The axios client with JWT interceptor and refresh-subscriber queue lives in `frontend/src/api/client.ts` — it uses standard `axios.create`, interceptors, and `localStorage` token helpers. No exotic axios APIs.

## Commands you will need

| Purpose | Command (from `/frontend`) | Expected on success |
|---|---|---|
| Audit | `npm audit --omit=dev` | before: 5 vulns; after: `found 0 vulnerabilities` |
| Fix | `npm audit fix` | exit 0, lockfile updated |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Format check | `npm run format:check` | exit 0 |
| Tests | `npm run test:run` | all pass |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**: `frontend/package.json`, `frontend/package-lock.json`.

**Out of scope**:

- Any source-code change. If `npm audit fix` forces a breaking axios major (it should not — fix is advertised as semver-compatible), STOP.
- `npm audit fix --force` — never use it.
- Mantine packages (pinned `9.0.0-alpha.1` deliberately — plan 008 handles them).
- Backend dependencies.

## Git workflow

- Branch: `advisor/002-frontend-dependency-vulns`
- Single commit, e.g. `fix: bump axios + transitive deps for npm audit vulnerabilities`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Record the baseline

`cd frontend && npm audit --omit=dev` → confirm the 5 vulnerabilities above. If the list differs materially (new criticals, or already zero), STOP and report.

### Step 2: Apply fixes

`npm audit fix` → exit 0. Then `git diff package.json` — expect at most version bumps on `axios` (and possibly `react-router-dom`); no packages added or removed, no Mantine lines touched.

**Verify**: `npm audit --omit=dev` → `found 0 vulnerabilities`.

### Step 3: Full verification

Run `npm run typecheck && npm run lint && npm run format:check && npm run test:run && npm run build` → all exit 0. The test suite covers the API client indirectly through page tests (e.g. `LoginPage.test.tsx`, `MessagesPage.test.tsx`).

## Test plan

No new tests — this is a dependency bump. The existing Vitest suite (`npm run test:run`) plus a production build are the regression gate. Pay attention to any test failure mentioning axios interceptors or request config.

## Done criteria

- [ ] `npm audit --omit=dev` → `found 0 vulnerabilities`
- [ ] `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:run`, `npm run build` all exit 0
- [ ] `git diff --stat` touches only `frontend/package.json` and `frontend/package-lock.json`
- [ ] Mantine entries in package.json still read `9.0.0-alpha.1`
- [ ] `plans/README.md` status row updated

## STOP conditions

- `npm audit fix` reports remaining vulnerabilities that require `--force` or a major-version bump → report which package and stop.
- Any test/build failure after the bump that isn't fixed by re-running install → report the failing output verbatim.
- `git diff package.json` shows Mantine, react, or vite version changes.

## Maintenance notes

- Quarterly `npm audit --omit=dev` is cheap; consider adding it to `.github/workflows/ci.yml` as a non-blocking step.
- The react-router fix only removes the library-level open redirect; the app should still never feed user input into `<Navigate to>` — nothing currently does.
