#!/bin/sh
set -e

# Startup tasks (migrations + search index) must run exactly once per deploy, from
# a single container. The primary `backend` (HTTP/gunicorn) container owns them;
# auxiliary containers (huey, backend-ws) set SKIP_STARTUP_TASKS=1 and depend on
# `backend` being healthy, so the DB is already migrated by the time they start.
#
# The flag file is created by deploy.sh after running these tasks pre-restart, so
# containers can start serving immediately during deploys.
if [ -f /app/data/.deploy_tasks_done ] || [ "$SKIP_STARTUP_TASKS" = "1" ]; then
    echo "Skipping startup tasks (pre-completed by deploy script or SKIP_STARTUP_TASKS=1)..."
else
    # Restore database from Litestream replica if S3 is configured and DB doesn't exist yet
    if [ -n "$S3_BACKUP_BUCKET" ] && [ ! -f /app/data/db.sqlite3 ]; then
        echo "Restoring database from Litestream replica..."
        litestream restore -config /etc/litestream.yml -if-replica-exists /app/data/db.sqlite3
    fi

    echo "Running database migrations..."
    uv run python manage.py migrate --noinput

    echo "Rebuilding search index (if empty)..."
    _search_start=$(date +%s%3N)
    uv run python manage.py rebuild_search_index --if-empty
    _search_end=$(date +%s%3N)
    echo "Search index step finished in $((_search_end - _search_start))ms"

fi

# If a command was passed (e.g. huey via docker-compose `command:`, or Daphne for
# the backend-ws WebSocket service), run it directly. Litestream only wraps the
# default HTTP server below, not auxiliary commands.
if [ $# -gt 0 ]; then
    echo "Running custom command: $@"
    exec "$@"
fi

# Default process = HTTP server. We serve HTTP via gunicorn (WSGI), NOT Daphne.
#
# Why: under Daphne/ASGI, Django's persistent connections (CONN_MAX_AGE) were not
# reused — every request opened a fresh SQLite connection, and a fresh connect under
# concurrency costs ~30ms (vs ~0 when reused). That `connect` cost dominated nearly
# every endpoint's latency. gunicorn's gthread workers reuse one DB connection per
# worker thread, eliminating the churn. WebSockets still need ASGI, so Daphne runs
# in the separate `backend-ws` service (Traefik routes /ws there).
#
# Single-quoted '*' so the shell that runs this string (Litestream -exec or `sh -c`)
# does not glob-expand it; gunicorn needs it to trust X-Forwarded-* from Traefik.
GUNICORN_CMD="uv run gunicorn config.wsgi:application \
    --bind 0.0.0.0:8000 \
    --workers ${GUNICORN_WORKERS:-2} \
    --threads ${GUNICORN_THREADS:-4} \
    --worker-class gthread \
    --worker-tmp-dir /dev/shm \
    --timeout 60 \
    --graceful-timeout 30 \
    --keep-alive 5 \
    --forwarded-allow-ips='*' \
    --error-logfile -"

# Use Litestream for continuous SQLite replication when S3 is configured.
# Litestream wraps the HTTP server as a child process (-exec) and replicates WAL
# changes to S3. On graceful shutdown (SIGTERM/SIGINT), Litestream syncs outstanding
# changes before exiting. (Writes from huey and backend-ws are captured too —
# Litestream replicates the shared WAL file regardless of which process wrote it.)
if [ -n "$S3_BACKUP_BUCKET" ]; then
    echo "Starting Litestream replication + Gunicorn (HTTP/WSGI)..."
    exec litestream replicate -config /etc/litestream.yml -exec "$GUNICORN_CMD"
else
    echo "Starting Gunicorn (HTTP/WSGI, no Litestream — S3 not configured)..."
    exec sh -c "$GUNICORN_CMD"
fi
