#!/bin/sh
set -e

# Flag file is created by deploy.sh after running these tasks pre-restart.
# This allows the container to start serving immediately during deploys.
if [ -f /app/data/.deploy_tasks_done ]; then
    echo "Startup tasks pre-completed by deploy script, skipping..."
else
    echo "Running database migrations..."
    uv run python manage.py migrate --noinput

    echo "Rebuilding search index..."
    _search_start=$(date +%s%3N)
    uv run python manage.py rebuild_search_index
    _search_end=$(date +%s%3N)
    echo "Search index rebuilt in $((_search_end - _search_start))ms"

fi

# If a command was passed (e.g. from docker-compose `command:`), run it
if [ $# -gt 0 ]; then
    echo "Running custom command: $@"
    exec "$@"
fi

echo "Starting Daphne..."
exec uv run daphne \
    --proxy-headers \
    --ping-interval 20 \
    --ping-timeout 30 \
    -v 1 \
    -b 0.0.0.0 \
    -p 8000 \
    config.asgi:application
