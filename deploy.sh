#!/bin/sh
set -e

echo "Pulling latest changes..."
git pull

echo "Building and restarting services..."
docker compose up -d --build

echo "Cleaning up old images..."
docker image prune -f

echo "Waiting for backend health check..."
timeout=60
elapsed=0
while [ $elapsed -lt $timeout ]; do
    if docker compose exec -T backend python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health/')" 2>/dev/null; then
        echo "Backend is healthy."
        exit 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
done

echo "WARNING: Backend did not become healthy within ${timeout}s. Check logs with: docker compose logs backend"
exit 1
