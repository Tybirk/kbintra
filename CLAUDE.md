# CLAUDE.md 

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

KB Intra is a community communication platform for a co-living community (~90 users). It features forum discussions, food management (meal registration, tickets, cooking teams), direct messaging, calendar, and resident directory.
It is a small scale app, with few developers who do not wish to spend time maintaining it, but it is also critical infrastructure for our community, so the app should be simple and rock solid at the same time and easy to debug.

## Tech Stack

- **Backend**: Django 5.x + Django REST Framework + Django Channels (WebSockets via Daphne) + Huey (task queue)
- **Frontend**: React 19 + TypeScript + Vite + Mantine UI v8 + Zustand + React Query + Tiptap
- **Infrastructure**: Redis (channel layer), Traefik (reverse proxy), Cloudflare Tunnel (ingress)
- **Package Managers**: uv (Python), npm (JavaScript)
- **Database**: SQLite (dev/prod - suitable for ~90 users)

## Common Commands

### Dev Setup (run from project root)

```bash
uv run setup.py                            # One-command setup (deps, migrations, search index)
uv run dev.py                              # Start backend + frontend dev servers
```

### Backend (run from `/backend`)

```bash
uv sync                                    # Install dependencies
uv run python manage.py runserver          # Dev server (HTTP only)
uv run daphne -b 0.0.0.0 -p 7000 config.asgi:application  # With WebSocket support
uv run python manage.py migrate            # Apply migrations
uv run python manage.py makemigrations     # Create migrations
uv run pytest                              # Run all tests
uv run pytest apps/forum/tests.py -v       # Run specific app tests
uv run pytest -k "test_name"               # Run single test by name
uv run ruff check .                        # Lint
uv run ruff format .                       # Format
uvx ty check                               # Type check
```

### Frontend (run from `/frontend`)

```bash
npm install                                # Install dependencies
npm run dev                                # Dev server (port 5173)
npm run build                              # Production build (tsgo + vite)
npm run typecheck                          # Type check (tsgo)
npm run lint                               # Lint (oxlint)
npm run format                             # Format (oxfmt)
npm run format:check                       # Check formatting
npm test                                   # Vitest (watch mode)
npm run test:run                           # Single test run
npm run test:coverage                      # With coverage
```

### Docker (run from project root)

```bash
docker compose -f docker-compose.local.yml up -d --build  # Local dev
docker compose up -d --build                               # Production
```

Note: Migrations run automatically on backend container startup via `docker-entrypoint.sh`.

## Architecture

### Backend Structure

8 Django apps in `backend/apps/`:
- `users` - Custom User model (email-based auth), invitations, profiles
- `houses` - Resident directory by house
- `forum` - Subgroups → Threads → Posts (Tiptap HTML), Files/Folders
- `food` - MenuTemplates → WeeklyMenu → DailyMenu, MealRegistration, FoodTickets, FoodTeams
- `announcements` - Priority community posts
- `calendar_app` - Community events
- `messaging` - 1:1 and group conversations with real-time messages (encrypted at rest)
- `notifications` - In-app + email + push notifications with preferences

### Frontend Structure

- `frontend/src/api/` - Axios client with JWT interceptor + API modules per feature
- `frontend/src/pages/` - Page components
- `frontend/src/components/` - Shared components (AppHeader, AppNavbar, RichTextEditor)
- `frontend/src/store/authStore.ts` - Zustand auth state
- `frontend/src/types/index.ts` - All TypeScript types

### API & Real-time

- REST endpoints: `/api/{auth,users,houses,forum,announcements,food,calendar,messages,notifications}/`
- WebSocket: `ws://localhost:7000/ws/chat/?token=<jwt>` - messaging, notifications, typing indicators
- Health check: `GET /api/health/` (unauthenticated, used by Docker healthcheck)
- Vite proxies `/api` and `/media` to backend in dev (configured in vite.config.ts)
- Production: Traefik routes `/api`, `/ws`, `/admin`, `/media`, `/static` to backend

### Auth Flow

- Email-based login (no username)
- JWT: access token (1 hour), refresh token (7 days with rotation)
- Invitation-only registration with house assignment
- Frontend auto-refreshes tokens via axios interceptor (subscriber queue prevents duplicate refresh requests)

For detailed architecture docs (Huey tasks, production infrastructure, message encryption, search), see `docs/architecture.md`.

## Important Patterns & Gotchas

### Search index signals
The `search` app keeps its FTS5 index in sync via `post_save`/`post_delete` signals registered in `SearchConfig.ready()`. When adding or modifying searchable models, check `backend/apps/search/signals.py`. See `backend/apps/search/SEARCH.md` for full docs.

### Periodic background tasks
Two Huey periodic tasks exist beyond one-off tasks:
- **Event reminders** (`apps/events/tasks.py`) — hourly, sends 24h and 1h reminders
- **Food team defaults** (`apps/food/tasks.py`) — Thursday 1 AM, cycles cooking teams

Use `@db_periodic_task(crontab(...))` for new periodic tasks. Import the task module in the app's `AppConfig.ready()` to register it.

### Huey task rules
- Use `@db_task()` for transactional tasks, `@task()` for non-transactional
- Pass only serializable primitives (int, str, bool) — never Django model instances
- Import models inside the task function body, not at module top level
- `immediate: DEBUG` — tasks run synchronously in dev, async via worker in production

### Frontend version check
`useVersionCheck()` polls `/version.json` every 5 minutes and force-reloads when a new version is detected. It has iOS PWA-specific workarounds. If the page reloads unexpectedly, this is likely why.

### Service worker & push notifications
Custom service worker (`frontend/src/sw.ts`) handles push notifications with iOS Safari-specific workarounds (no icon support, different event handling). Notifications are collapsed per type+URL to prevent spam.

### Sentry error filtering
`_sentry_before_send` in `settings.py` drops JWT token errors (TokenError, InvalidToken, TokenExpiredError) to reduce noise. If errors seem missing from Sentry, check this filter.

### Pre-commit hooks
Uses `prek` (not standard `pre-commit`). Hooks run ruff, frontend lint/format/typecheck. They source `~/.nvm/nvm.sh` for Node access. Install with `uv tool install prek && prek install -f .`.

### Message encryption
Private messages are encrypted at rest using Fernet. Key stored in `MESSAGES_ENCRYPTION_KEY` env var. Required in production, optional in dev. See `docs/architecture.md` for details.

## Key Files for Common Tasks

- Adding a new API endpoint: `backend/apps/<app>/views.py`, `backend/apps/<app>/urls.py`, `backend/config/urls.py`
- Adding a new page: `frontend/src/pages/`, `frontend/src/App.tsx` (routes)
- Adding a new API type: `frontend/src/types/index.ts`, `frontend/src/api/<module>.ts`
- Modifying WebSocket: `backend/apps/messaging/consumers.py`, `backend/config/asgi.py`
- Modifying production setup: `docker-compose.yml`, `backend/Dockerfile`, `backend/docker-entrypoint.sh`

## Code Style

- Mobile-first: design and implement UI for mobile screens first, then adapt for desktop
- Python: Ruff (line-length 100, py311), ty (type checking)
- TypeScript: oxlint (linting), oxfmt (formatting), tsgo (type checking)
- Tests: pytest-django (backend), Vitest + Testing Library (frontend)

### TypeScript: avoid inline object types inside generics

oxlint removes semicolons from inline object types inside generics, producing invalid syntax. Always extract to a named interface instead:

```typescript
// BAD — oxlint strips the semicolon, breaking the build:
const items: Array<{ id: number; name: string }> = []
useState<Array<{ id: number | null; name: string }>>([])

// GOOD — extract to a named interface:
interface FolderPathEntry { id: number | null; name: string }
const items: FolderPathEntry[] = []
useState<FolderPathEntry[]>([])
```

## Required Checks (Backend)

```bash
uv run ruff check --fix .   # Linting
uv run ruff format .        # Formatting
uvx ty check                # Type checking
uv run pytest               # Tests
```

## Required Checks (Frontend)

```bash
npm run typecheck     # Type checking (tsgo)
npm run lint          # Linting (oxlint)
npm run format:check  # Formatting check (oxfmt)
npm run test:run      # Tests
```

ALL user facing text in the app must be in Danish! (Not in our conversations!)

## Adding New Models or Columns

When adding a new major database model or a significant column to an existing model, consider whether it should be included in the full-text search index. See `backend/apps/search/SEARCH.md` for details on how to add a new searchable model (signals, rebuild command, type mapping).

Also in general prefer slugs to IDs for use in URLs.
