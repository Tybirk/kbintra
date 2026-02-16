#!/bin/sh
set -e

echo "Running database migrations..."
uv run python manage.py migrate --noinput

echo "Checking search index..."
uv run python manage.py rebuild_search_index --if-empty

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
