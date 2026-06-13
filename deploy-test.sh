#!/bin/sh
# Test-server deploy wrapper.
#
# 1. Read-only rsync of the production SQLite DB + WAL/SHM and media/ from
#    kbintra-dev. Strictly one-way: prod is the rsync SOURCE only — nothing is
#    created/modified/deleted on the prod host.
# 2. Then runs the standard ./deploy.sh (build, migrate, swap containers).
#
# Run as ghrunner, from /opt/kbintra-test2.
set -e

cd "$(dirname "$0")"

# Path to prod data directory on kbintra-dev. Override via env if needed.
PROD_REMOTE=${PROD_REMOTE:-kbintra-dev}
PROD_DATA_DIR=${PROD_DATA_DIR:-/root/kbintra-prod/data}

echo ">>> Rsyncing prod SQLite files from $PROD_REMOTE:$PROD_DATA_DIR (read-only)..."
mkdir -p ./data

# Main DB file (required).
rsync -avz --inplace \
    "$PROD_REMOTE:$PROD_DATA_DIR/db.sqlite3" \
    ./data/db.sqlite3

# WAL/SHM files (best-effort; may not exist if prod has no in-flight writes).
rsync -avz --inplace \
    "$PROD_REMOTE:$PROD_DATA_DIR/db.sqlite3-wal" \
    ./data/db.sqlite3-wal 2>/dev/null || rm -f ./data/db.sqlite3-wal
rsync -avz --inplace \
    "$PROD_REMOTE:$PROD_DATA_DIR/db.sqlite3-shm" \
    ./data/db.sqlite3-shm 2>/dev/null || rm -f ./data/db.sqlite3-shm

# Media files written by the backend container are root-owned on the host (the
# container runs as root). Without sudo, this deploy user can't let the rsync
# below --delete the test-only ones (e.g. expense_receipts uploaded while
# testing, which don't exist on prod). Hand ownership back to the deploy user
# via a container first — root inside the container can chown freely.
#
# Best-effort: prefer the already-running backend container; fall back to a
# one-off container on its image. On a brand-new box neither exists, but then
# ./data/media is empty too, so there's nothing for --delete to trip over.
echo ">>> Reclaiming ownership of ./data/media so --delete can clean test-only files..."
OWNER="$(id -u):$(id -g)"
if ! docker compose exec -T backend chown -R "$OWNER" /app/data/media 2>/dev/null; then
    BACKEND_IMG=$(docker compose images -q backend 2>/dev/null | head -1)
    if [ -n "$BACKEND_IMG" ]; then
        # --entrypoint chown: the backend image's default entrypoint isn't a
        # shell, so override it to run chown directly with the args below.
        docker run --rm --entrypoint chown -v "$(pwd)/data:/app/data" \
            "$BACKEND_IMG" -R "$OWNER" /app/data/media 2>/dev/null || true
    fi
fi

# Media files (one-way: prod is SOURCE, local test is DEST).
# --delete removes files in ./data/media/ that are gone from prod; prod is never written to.
echo ">>> Rsyncing prod media from $PROD_REMOTE:$PROD_DATA_DIR/media/ (read-only)..."
mkdir -p ./data/media
rsync -avz --delete \
    "$PROD_REMOTE:$PROD_DATA_DIR/media/" \
    ./data/media/

echo ">>> Running standard deploy.sh..."
exec ./deploy.sh
