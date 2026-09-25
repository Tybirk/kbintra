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
./deploy.sh

# The rsync above replaced the database with prod's, so anything staged only for
# testing is gone. Put the food-team plan back: it is the thing being tested
# right now, and retyping ninety names by hand is not a test step.
#
# ./data survives the rsync (only db.sqlite3 and media/ are overwritten), so the
# roster we imported from stays put and can simply be replayed. Best-effort:
# a stale or half-written roster must not fail a deploy that already succeeded.
# --skip-if-past stops once the period is over, so an old plan is not
# resurrected on every deploy forever; the year comes from a '# år: 2026'
# header in the file, so this keeps working without editing the script.
# Drop in a newer list to test a newer period.
ROSTER=./data/madhold-import.txt
if [ -f "$ROSTER" ]; then
    echo ">>> Re-importing the food-team plan from $ROSTER (test-only data)..."
    docker compose exec -T backend uv run python manage.py import_food_teams \
        "/app/data/$(basename "$ROSTER")" --replace --skip-if-past \
        || echo "WARNING: could not re-import $ROSTER; the test server has prod's teams only."
fi

# Same reasoning as the roster: Driftsudvalgets 13 real cases live only in the
# export from their previous reporting app, so the database rsync above wipes
# them from the test site on every deploy. The export sits in ./data (which
# survives the rsync), so it can simply be replayed. The import is idempotent on
# (udvalg, sagsnummer) and re-creates the photos too, so it is safe to run every
# time. reporting_enabled is set by a data migration, not by hand, for the same
# reason — a flag set in admin would not survive either.
REPORTS_EXPORT=$(ls ./data/Sager*.xlsx 2>/dev/null | head -1)
if [ -n "$REPORTS_EXPORT" ]; then
    echo ">>> Re-importing Driftsudvalgets cases from $REPORTS_EXPORT (test-only data)..."
    docker compose exec -T backend uv run python manage.py import_du_reports \
        "/app/data/$(basename "$REPORTS_EXPORT")" \
        || echo "WARNING: could not re-import $REPORTS_EXPORT; the test server has no cases."
fi
