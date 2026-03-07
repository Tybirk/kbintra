# Architecture Details

Detailed documentation for subsystems. See `CLAUDE.md` for the quick reference.

## Background Tasks (Huey)

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

**Periodic tasks** use `@db_periodic_task(crontab(...))` and must be imported in `AppConfig.ready()`:
```python
from huey.contrib.djhuey import db_periodic_task
from huey import crontab

@db_periodic_task(crontab(minute="0"))  # every hour
def my_periodic_task():
    ...
```

**Calling tasks** (from views/services):
```python
from apps.notifications.tasks import send_email_task
send_email_task(user.id, notification_type, title, message, link, related_user_id, html_content)
```

**Running the worker**:
```bash
# Dev: not needed (immediate=True runs tasks synchronously)
# Production (or to test async behavior):
uv run python manage.py run_huey -w 2 -k thread --flush-locks
```

**Docker**: The `huey` service in `docker-compose.yml` runs the worker. It shares the same `huey.db` and `db.sqlite3` volumes as the `backend` service.

**Existing tasks**:
- `apps/notifications/tasks.py` — `send_email_task`, `send_push_task`, `notify_new_message_task`, `notify_message_reaction_task`, `notify_mentions_task`
- `apps/events/tasks.py` — `send_event_reminders` (hourly periodic)
- `apps/food/tasks.py` — `apply_weekly_defaults_task` (Thursday 1 AM periodic)

## Production Infrastructure

**Docker services** (`docker-compose.yml`):
- `traefik` — Reverse proxy, routes by path prefix to backend/frontend. Rate limiting: 100 req/s general, 5 req/s for auth endpoints.
- `cloudflared` — Cloudflare Tunnel for secure ingress (no exposed ports)
- `redis` — Channel layer backend for Django Channels (WebSocket message routing)
- `backend` — Daphne ASGI server (HTTP + WebSocket)
- `huey` — Background task worker
- `frontend` — Nginx serving the React SPA

**Daphne configuration** (`backend/docker-entrypoint.sh`):
- Runs migrations automatically on startup
- Runs `rebuild_search_index` and `apply_weekly_defaults` on startup
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
- Log rotation: `max-size: 10m`, `max-file: 3`

**Security** (production only):
- HSTS, secure cookies, CSP headers enabled
- Sentry integration with custom error filtering (JWT token errors dropped)
- Source maps uploaded to Sentry at build time, then deleted

## Message Encryption

Private messages are encrypted at rest using Fernet (AES-128-CBC + HMAC). The encryption key is stored in the `MESSAGES_ENCRYPTION_KEY` environment variable.

**Implementation** (`backend/apps/messaging/encryption.py`):
- `EncryptedTextField` — custom Django field that encrypts via `get_prep_value()` and decrypts via `from_db_value()`
- Encrypted values are prefixed with `fernet:` to distinguish from plaintext
- Decryption failure (wrong/missing key) returns `[krypteret besked]`

**Generating a key**:
```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

**Configuration**:
- Production (`DEBUG=False`): Key is **required** — the app refuses to start without it
- Development (`DEBUG=True`): Key is optional — messages are stored as plaintext without it
- Encrypted messages from a production DB copy show as `[krypteret besked]` without the key

**Initial setup** (first deploy with encryption):
1. Generate a key and add `MESSAGES_ENCRYPTION_KEY=<key>` to the production environment
2. Deploy (migrations run automatically)
3. Run `docker exec <backend-container> uv run python manage.py encrypt_messages` once to encrypt existing messages
4. Back up the key separately from the database — if lost, encrypted messages are **unrecoverable**

## Full-Text Search (FTS5)

The `search` app provides global search using SQLite FTS5 with recency-boosted BM25 ranking. See `backend/apps/search/SEARCH.md` for full architecture docs.

**Key commands**:
```bash
uv run python manage.py rebuild_search_index            # Full reindex
uv run python manage.py rebuild_search_index --if-empty  # Only if index is empty (used on container startup)
```

**How it stays in sync**: Signals in `apps/search/signals.py` update the index on `post_save`/`post_delete`. Registered via `SearchConfig.ready()` in `apps/search/apps.py`.

**Adding a new searchable model**: Add signals in `signals.py`, indexing in `rebuild_search_index.py`, type mapping in `views.py:TYPE_TO_KEY`.

## Environment Variables Reference

Required in production (app crashes without these):
- `SECRET_KEY` — Django secret key
- `MESSAGES_ENCRYPTION_KEY` — Fernet key for message encryption
- `ALLOWED_HOSTS` — Comma-separated hostnames
- `CLOUDFLARE_TUNNEL_TOKEN` — Cloudflare Tunnel token

Important optional:
- `SITE_URL` — Base URL for links in emails/notifications (default: `http://localhost:5173`)
- `CORS_ALLOWED_ORIGINS` — Comma-separated origins
- `CSRF_TRUSTED_ORIGINS` — Comma-separated origins
- `REDIS_URL` — Redis connection for channel layer (falls back to in-memory)
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_ADMIN_EMAIL` — Web Push notifications
- `GOOGLE_DRIVE_API_KEY`, `GOOGLE_DRIVE_MENU_FOLDER_ID` — Google Drive menu integration
- `SENTRY_DSN`, `SENTRY_ENVIRONMENT` — Error tracking
- `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USE_TLS`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD` — SMTP config
- `DEFAULT_FROM_EMAIL` — Sender address (default: `noreply@example.com`)
