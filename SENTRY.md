# Sentry Setup

Sentry is fully integrated but **disabled by default** — nothing is sent until you set `SENTRY_DSN`.

## 1. Create a Sentry project

1. Go to [sentry.io](https://sentry.io) and create an account (free tier is sufficient for ~90 users).
2. Create **one project** — choose platform **Django** (you'll use the same DSN for both backend and frontend).
3. Copy the DSN from **Settings → Projects → Your project → Client Keys (DSN)**.
   It looks like: `https://abc123@o123456.ingest.sentry.io/789`

## 2. Add vars to your `.env` file

```bash
# Required — the same DSN is used for backend (Django) and frontend (React)
SENTRY_DSN=https://abc123@o123456.ingest.sentry.io/789

# Optional — defaults to "production" in docker-compose
SENTRY_ENVIRONMENT=production

# Optional — a human-readable release tag shown in Sentry
# Useful for correlating errors to a deployment; can be omitted.
SENTRY_RELEASE=v1.2.3
```

That's all that's needed for basic error tracking to work.

## 3. Rebuild and deploy

```bash
docker compose up -d --build
```

Both the backend and frontend containers read from the same `SENTRY_DSN` variable.

---

## Source maps (readable frontend stack traces)

Without source maps, frontend errors in Sentry will point to minified JS lines.
With them, you see the exact TypeScript file and line number.

Source maps are only built and uploaded when `SENTRY_AUTH_TOKEN` is set, so they
never end up being served publicly.

### One-time setup

1. In Sentry: **Settings → Auth Tokens → Create new token** with scopes:
   `project:releases`, `project:write`, `org:read`.
2. Find your org slug: visible in your Sentry URL — `sentry.io/organizations/<slug>/`.
3. Find your project slug: **Settings → Projects → Your project** → the slug in the URL.

### Add to `.env`

```bash
SENTRY_AUTH_TOKEN=sntrys_xxxxxxxxxxxx
SENTRY_ORG=your-org-slug
SENTRY_PROJECT=your-project-slug
```

### Rebuild frontend

```bash
docker compose up -d --build frontend
```

During the build, the Vite plugin uploads `.map` files to Sentry and then deletes them from
the `dist/` folder. The nginx container never serves them.

---

## What gets reported

### Backend (Django + Huey)

| What | How |
|------|-----|
| Unhandled exceptions in API views | Automatic via `DjangoIntegration` |
| Unhandled exceptions in Huey background tasks | Automatic via `HueyIntegration` |
| SQL queries before an error (breadcrumbs) | Automatic via `DjangoIntegration` |
| Redis operations before an error (breadcrumbs) | Automatic via `RedisIntegration` |
| `logger.error(...)` calls as Sentry events | Automatic via `LoggingIntegration` |
| `logger.info(...)` calls as breadcrumbs | Automatic via `LoggingIntegration` |
| Authenticated user (email, name) attached to errors | Automatic via `send_default_pii=True` |
| Performance traces (10% of requests, configurable) | Automatic via `DjangoIntegration` |
| CPU profiling (10% of traced requests, configurable) | Automatic |

Intentional noise is filtered out: `TokenError` / `InvalidToken` from simplejwt are dropped
in `before_send` since they are expected user-facing errors, not server bugs.

### Frontend (React)

| What | How |
|------|-----|
| Unhandled JS errors | Automatic |
| React component crashes (both error boundaries) | `Sentry.captureException` in `ErrorBoundary` and `PageErrorBoundary` |
| Authenticated user context | Set in `authStore` on login, cleared on logout |
| Page view performance (per route pattern, e.g. `/forum/:slug`) | `reactRouterV6BrowserTracingIntegration` + `SentryRoutes` |
| Session replay on errors | `replayIntegration` (100% on error, 0% otherwise) |

---

## Tuning sample rates

The defaults are conservative. Change them in `.env` and redeploy:

```bash
# Backend
SENTRY_TRACES_SAMPLE_RATE=0.1   # 0.0–1.0, default 0.1 (10%)
SENTRY_PROFILES_SAMPLE_RATE=0.1 # 0.0–1.0, default 0.1 (10%)
```

For the frontend, edit `frontend/src/main.tsx` directly:
```ts
tracesSampleRate: 0.1,          // 10% of page navigations
replaysSessionSampleRate: 0.0,  // never record full sessions (saves quota)
replaysOnErrorSampleRate: 1.0,  // always replay when there's an error
```

For a small 90-user app the defaults are fine and will use very little Sentry quota.

---

## Local development

Sentry is **not active** in local dev unless you explicitly set `SENTRY_DSN` in your shell
before starting the dev server. There's no `.env` file for the frontend dev server — you'd
have to do:

```bash
VITE_SENTRY_DSN=https://... npm run dev
```

You'll almost never want this. Leave it unset locally.
