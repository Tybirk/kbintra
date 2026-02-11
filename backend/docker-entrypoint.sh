#!/bin/sh
set -e

echo "Running database migrations..."
uv run python manage.py migrate --noinput

echo "Starting Daphne..."
exec uv run daphne \
    --proxy-headers \
    --ping-interval 20 \
    --ping-timeout 30 \
    -v 1 \
    -b 0.0.0.0 \
    -p 8000 \
    config.asgi:application
