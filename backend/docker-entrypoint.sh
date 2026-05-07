#!/bin/sh
set -e

# Flag file is created by deploy.sh after running these tasks pre-restart.
# This allows the container to start serving immediately during deploys.
if [ -f /app/data/.deploy_tasks_done ]; then
    echo "Startup tasks pre-completed by deploy script, skipping..."
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

# If a command was passed (e.g. from docker-compose `command:` for huey), run it directly.
# Litestream only wraps the default Daphne process, not auxiliary commands.
if [ $# -gt 0 ]; then
    echo "Running custom command: $@"
    exec "$@"
fi

# Use Litestream for continuous SQLite replication when S3 is configured.
# Litestream wraps Daphne as a child process (-exec) and replicates WAL changes to S3.
# On graceful shutdown (SIGTERM/SIGINT), Litestream syncs outstanding changes before exiting.
if [ -n "$S3_BACKUP_BUCKET" ]; then
    echo "Starting Litestream replication + Daphne..."
    exec litestream replicate -config /etc/litestream.yml \
        -exec "uv run daphne --proxy-headers --ping-interval 20 --ping-timeout 30 -v 1 -b 0.0.0.0 -p 8000 config.asgi:application"
else
    echo "Starting Daphne (no Litestream — S3 not configured)..."
    exec uv run daphne \
        --proxy-headers \
        --ping-interval 20 \
        --ping-timeout 30 \
        -v 1 \
        -b 0.0.0.0 \
        -p 8000 \
        config.asgi:application
fi
