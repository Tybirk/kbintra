#!/bin/sh
set -e

# Tag current state for rollback
DEPLOY_TAG="deploy-$(date +%Y%m%d-%H%M%S)"
echo "Tagging current state as $DEPLOY_TAG (for rollback: git checkout $DEPLOY_TAG)"
git tag "$DEPLOY_TAG"

echo "Pulling latest changes..."
git pull

echo "Backing up database..."
mkdir -p ./data/backups
if [ -f ./data/db.sqlite3 ]; then
    backup_file="./data/backups/db-$(date +%F-%H%M%S).sqlite3"
    sqlite3 ./data/db.sqlite3 ".backup '${backup_file}'"
    echo "Backup saved to ${backup_file}"
    # Keep only the 10 most recent backups
    ls -t ./data/backups/db-*.sqlite3 2>/dev/null | tail -n +11 | xargs -r rm
fi

echo "Ensuring data files exist..."
mkdir -p ./data
touch ./data/db.sqlite3 ./data/huey.db

echo "Building and restarting services..."
docker compose up -d --build

echo "Cleaning up old images..."
docker image prune -f

echo "Waiting for backend health check..."
timeout=60
elapsed=0
while [ $elapsed -lt $timeout ]; do
    if docker compose exec -T backend uv run python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health/')" 2>/dev/null; then
        echo "Backend is healthy."
        echo ""
        echo "Deploy complete. To rollback: git checkout $DEPLOY_TAG && docker compose up -d --build"
        exit 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
done

echo "WARNING: Backend did not become healthy within ${timeout}s."
echo "Check logs with: docker compose logs backend"
echo "To rollback: git checkout $DEPLOY_TAG && docker compose up -d --build"
exit 1
