# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

KB Intra is a community communication platform for a co-living community (~90 users). It features forum discussions, food management (meal registration, tickets, cooking teams), direct messaging, calendar, and resident directory.

## Tech Stack

- **Backend**: Django 5.x + Django REST Framework + Django Channels (WebSockets via Daphne)
- **Frontend**: React 19 + TypeScript + Vite + Mantine UI v8 + Zustand + React Query + Tiptap
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
docker compose exec backend uv run python manage.py migrate
```

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
- Vite proxies `/api` and `/media` to backend in dev (configured in vite.config.ts)
- Production: Traefik routes `/api`, `/admin`, `/media`, `/static` to backend

### Auth Flow

- Email-based login (no username)
- JWT: access token (1 hour), refresh token (7 days with rotation)
- Invitation-only registration with house assignment
- Frontend auto-refreshes tokens via axios interceptor

## Key Files for Common Tasks

- Adding a new API endpoint: `backend/apps/<app>/views.py`, `backend/apps/<app>/urls.py`, `backend/config/urls.py`
- Adding a new page: `frontend/src/pages/`, `frontend/src/App.tsx` (routes)
- Adding a new API type: `frontend/src/types/index.ts`, `frontend/src/api/<module>.ts`
- Modifying WebSocket: `backend/apps/messaging/consumers.py`, `backend/config/asgi.py`

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
