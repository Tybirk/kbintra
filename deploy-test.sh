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

# Media files (one-way: prod is SOURCE, local test is DEST).
# --delete removes files in ./data/media/ that are gone from prod; prod is never written to.
echo ">>> Rsyncing prod media from $PROD_REMOTE:$PROD_DATA_DIR/media/ (read-only)..."
mkdir -p ./data/media
rsync -avz --delete \
    "$PROD_REMOTE:$PROD_DATA_DIR/media/" \
    ./data/media/

echo ">>> Running standard deploy.sh..."
exec ./deploy.sh
