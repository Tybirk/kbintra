#!/bin/sh
set -e

# Tag current state for rollback
DEPLOY_TAG="deploy-$(date +%Y%m%d-%H%M%S)"
echo "Tagging current state as $DEPLOY_TAG (for rollback: git checkout $DEPLOY_TAG)"
git tag "$DEPLOY_TAG"

echo "Pulling latest changes..."
git pull

echo "Ensuring data files exist..."
mkdir -p ./data ./data/backups
touch ./data/db.sqlite3 ./data/huey.db

echo "Backing up database..."
if [ -f ./data/db.sqlite3 ]; then
    backup_file="./data/backups/db-$(date +%F-%H%M%S).sqlite3"
    if python3 -c "import sqlite3; src=sqlite3.connect('./data/db.sqlite3'); dst=sqlite3.connect('${backup_file}'); src.backup(dst); dst.close(); src.close()"; then
        echo "Backup saved to ${backup_file}"
        # Keep only the 10 most recent backups
        ls -t ./data/backups/db-*.sqlite3 2>/dev/null | tail -n +11 | xargs -r rm
    else
        echo "WARNING: Database backup failed, continuing deploy..."
    fi
fi

echo "Building images..."
docker compose build

echo "Updating infrastructure services..."
docker compose up -d traefik cloudflared redis

echo "Rolling out backend (zero-downtime)..."
docker rollout -t 120 backend

echo "Rolling out frontend (zero-downtime)..."
docker rollout -t 60 frontend

echo "Updating huey worker..."
docker compose up -d huey

echo "Cleaning up old images..."
docker image prune -f

echo "Deploy complete. To rollback: git checkout $DEPLOY_TAG && docker compose up -d --build"
