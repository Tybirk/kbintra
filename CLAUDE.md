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
- `messaging` - 1:1 Conversations with real-time Messages
- `notifications` - In-app + email notifications with preferences

Key config files:
- `backend/config/settings.py` - Django settings (JWT, CORS, Channels)
- `backend/config/asgi.py` - WebSocket routing

### Frontend Structure

- `frontend/src/api/` - Axios client with JWT interceptor + API modules per feature
- `frontend/src/pages/` - 22 page components
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
- Frontend auto-refreshes tokens via axios interceptor

### Background Tasks (Huey)

Huey is used as a lightweight task queue for background work (emails, push notifications). It uses SQLite as its broker — no Redis needed.

**Configuration** (`backend/config/settings.py`):
- `huey.contrib.djhuey` is in `INSTALLED_APPS`
- `HUEY` dict configures `SqliteHuey` with broker at `backend/huey.db`
- `immediate: DEBUG` — tasks run synchronously in dev/test, async via worker in production
- 2 thread workers in production

**Writing tasks** (`backend/apps/<app>/tasks.py`):
```python
from huey.contrib.djhuey import db_task

@db_task(retries=3, retry_delay=2)
def my_task(user_id: int, ...) -> None:
    """Always pass primitive args (int, str) — not model instances."""
    from apps.users.models import User  # import inside task to avoid AppRegistryNotReady
    user = User.objects.get(id=user_id)
    # do work...
```

Key rules:
- Use `@db_task()` (wraps task execution in a database transaction) or `@task()` for no transaction
- Pass only serializable primitives (int, str, bool) — never Django model instances
- Import models inside the task function body, not at module top level
- Use `retries` and `retry_delay` for transient failures (network, SMTP, etc.)

**Calling tasks** (from views/services):
```python
from apps.notifications.tasks import send_email_task

# This enqueues immediately; the worker picks it up in the background
send_email_task(user.id, notification_type, title, message, link, related_user_id, html_content)
```

**Running the worker**:
```bash
# Dev: not needed (immediate=True runs tasks synchronously)
# Production (or to test async behavior):
uv run python manage.py run_huey -w 2 -k thread --flush-locks
```

**Docker**: The `huey` service in `docker-compose.yml` runs the worker. It shares the same `huey.db` and `db.sqlite3` volumes as the `backend` service.

**Existing tasks**: `backend/apps/notifications/tasks.py` — `send_email_task`, `send_push_task`

### Production Infrastructure

**Docker services** (`docker-compose.yml`):
- `traefik` — Reverse proxy, routes by path prefix to backend/frontend
- `cloudflared` — Cloudflare Tunnel for secure ingress (no exposed ports)
- `redis` — Channel layer backend for Django Channels (WebSocket message routing)
- `backend` — Daphne ASGI server (HTTP + WebSocket)
- `huey` — Background task worker
- `frontend` — Nginx serving the React SPA

**Daphne configuration** (`backend/docker-entrypoint.sh`):
- Runs migrations automatically on startup
- `--proxy-headers` — trusts X-Forwarded-For/Proto from Traefik
- `--ping-interval 20 --ping-timeout 30` — detects and cleans up stale WebSocket connections

**Channel layer** (`backend/config/settings.py`):
- Uses `channels_redis` when `REDIS_URL` env var is set (production/Docker)
- Falls back to `InMemoryChannelLayer` when `REDIS_URL` is empty (local dev, tests)

**Reliability features**:
- Health checks on Redis and backend (`/api/health/`) containers
- Graceful shutdown (`stop_signal: SIGINT`, `stop_grace_period: 30s`) on backend and huey
- Memory limits on all containers (512m backend, 256m huey, 128m others)
- SQLite write timeout of 20s to reduce `database is locked` errors from concurrent access

### Full-Text Search (FTS5)

The `search` app provides global search using SQLite FTS5 with recency-boosted BM25 ranking. See `backend/apps/search/SEARCH.md` for full architecture docs.

**Key commands**:
```bash
uv run python manage.py rebuild_search_index            # Full reindex
uv run python manage.py rebuild_search_index --if-empty  # Only if index is empty (used on container startup)
```

**Adding a new searchable model**: Add signals in `signals.py`, indexing in `rebuild_search_index.py`, type mapping in `views.py:TYPE_TO_KEY`.

## Key Files for Common Tasks

- Adding a new API endpoint: `backend/apps/<app>/views.py`, `backend/apps/<app>/urls.py`, `backend/config/urls.py`
- Adding a new page: `frontend/src/pages/`, `frontend/src/App.tsx` (routes)
- Adding a new API type: `frontend/src/types/index.ts`, `frontend/src/api/<module>.ts`
- Modifying WebSocket: `backend/apps/messaging/consumers.py`, `backend/config/asgi.py`
- Modifying production setup: `docker-compose.yml`, `backend/Dockerfile`, `backend/docker-entrypoint.sh`

## Code Style

- Python: Ruff (line-length 100, py311), ty (type checking)
- TypeScript: oxlint (linting), oxfmt (formatting), tsgo (type checking)
- Tests: pytest-django (backend), Vitest + Testing Library (frontend)

## Required Checks (Backend)

Before committing, ensure all checks pass:

```bash
uv run ruff check --fix .   # Linting
uv run ruff format .  # Formatting
uvx ty check         # Type checking
uv run pytest         # Tests
```

## Required Checks (Frontend)

Before committing, ensure all checks pass:

```bash
npm run typecheck     # Type checking (tsgo)
npm run lint          # Linting (oxlint)
npm run format:check  # Formatting check (oxfmt)
npm run test:run      # Tests
```

Also ensure that ALL user facing text in the app is in danish! (Not in our conversations!)

## Adding New Models or Columns

When adding a new major database model or a significant column to an existing model, consider whether it should be included in the full-text search index. See `backend/apps/search/SEARCH.md` for details on how to add a new searchable model (signals, rebuild command, type mapping).