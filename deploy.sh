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
touch ./data/huey.db

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

# S3 database backup is handled continuously by Litestream (no manual upload needed).

# Clean up deploy flag on exit (prevents stale flag if deploy fails mid-way)
cleanup() {
    rm -f ./data/.deploy_tasks_done
}
trap cleanup EXIT

# Images are built by CI (.github/workflows/ci.yml) and pulled here — the prod box
# never compiles. IMAGE_TAG = the exact commit we just checked out, so the running
# code and the pulled image can never drift apart.
export IMAGE_TAG=$(git rev-parse HEAD)

# CI only builds images for the tips of develop and main (.github/workflows/ci.yml).
# Waiting is worth it only while CI is plausibly building this very commit; for any
# other commit no image will ever appear, so fail at once instead of stalling 10 min.
pull_timeout=0
if git ls-remote origin refs/heads/develop refs/heads/main 2>/dev/null | grep -q "^$IMAGE_TAG"; then
    pull_timeout=600
fi

echo "Pulling images for $IMAGE_TAG from ghcr.io (old containers keep serving)..."

# Normal case: you ran deploy.sh right after pushing and CI is still building/pushing
# this commit's images. Retry the pull until they appear, up to 10 minutes.
pull_elapsed=0
until docker compose pull; do
    if [ "$pull_elapsed" -ge "$pull_timeout" ]; then
        if [ "$pull_timeout" -eq 0 ]; then
            echo "ERROR: no image on ghcr.io for $IMAGE_TAG, and CI never builds one for it."
            echo "HEAD ($(git rev-parse --abbrev-ref HEAD)) is not the tip of develop or main,"
            echo "so no CI run ever built this commit. Check out develop (or main) and retry."
        else
            echo "ERROR: images for $IMAGE_TAG are not on ghcr.io after ${pull_timeout}s."
            echo "Has CI finished building this commit? Check the Actions tab on GitHub."
        fi
        echo "Is this host logged in? Run: docker login ghcr.io"
        exit 1
    fi
    echo "Images not ready yet (CI may still be building). Retrying in 15s..."
    sleep 15
    pull_elapsed=$((pull_elapsed + 15))
done

echo "Running startup tasks with new image (old server still serving)..."
docker compose run --rm -T --entrypoint sh backend -c "
    # Restore database from Litestream replica on first deploy (DB doesn't exist yet)
    if [ -n \"\$S3_BACKUP_BUCKET\" ] && [ ! -f /app/data/db.sqlite3 ]; then
        echo 'Restoring database from Litestream replica...'
        litestream restore -config /etc/litestream.yml -if-replica-exists /app/data/db.sqlite3
    fi
    uv run python manage.py migrate --noinput && \
    uv run python manage.py rebuild_search_index --if-empty && \
    touch /app/data/.deploy_tasks_done"

echo "Swapping to new containers..."
docker compose up -d

echo "Cleaning up old images..."
docker image prune -f

echo "Waiting for backend health check..."
timeout=60
elapsed=0
while [ $elapsed -lt $timeout ]; do
    if docker compose exec -T backend uv run python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health/')" 2>/dev/null; then
        echo "Backend is healthy."
        echo ""
        echo "Deploy complete. To rollback: git checkout $DEPLOY_TAG && IMAGE_TAG=\$(git rev-parse HEAD) docker compose pull && docker compose up -d"
        exit 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
done

echo "WARNING: Backend did not become healthy within ${timeout}s."
echo "Check logs with: docker compose logs backend"
echo "To rollback: git checkout $DEPLOY_TAG && IMAGE_TAG=\$(git rev-parse HEAD) docker compose pull && docker compose up -d"
exit 1
