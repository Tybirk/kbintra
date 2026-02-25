#!/bin/sh
set -e

# Ensure systemd-resolved uses reliable public DNS (idempotent — safe to run every deploy)
DNS_CONF=/etc/systemd/resolved.conf.d/dns.conf
if [ ! -f "$DNS_CONF" ]; then
    echo "Configuring systemd-resolved to use public DNS (1.1.1.1, 8.8.8.8)..."
    sudo mkdir -p /etc/systemd/resolved.conf.d
    printf '[Resolve]\nDNS=1.1.1.1 8.8.8.8\n' | sudo tee "$DNS_CONF" > /dev/null
    sudo systemctl restart systemd-resolved
fi

# Check DNS resolution before doing anything
if ! nslookup github.com > /dev/null 2>&1; then
    echo "ERROR: DNS resolution is broken (nslookup github.com failed)."
    echo "Fix with: sudo rm /etc/resolv.conf && echo -e 'nameserver 1.1.1.1\nnameserver 8.8.8.8' | sudo tee /etc/resolv.conf"
    exit 1
fi

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
