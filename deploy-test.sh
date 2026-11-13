#!/bin/sh
# Test-server deploy wrapper.
#
# 1. Read-only copy of the production SQLite DB (a sqlite backup) and media/
#    from kbintra-dev. Strictly one-way: prod is the SOURCE only — nothing on
#    the prod host is modified, apart from the snapshot in its /tmp.
# 2. Stops the app containers, swaps the DB in, then runs the standard
#    ./deploy.sh (pull images, migrate, start containers).
#
# Run as ghrunner, from /opt/kbintra-test2.
set -e

cd "$(dirname "$0")"

# Path to prod data directory on kbintra-dev. Override via env if needed.
PROD_REMOTE=${PROD_REMOTE:-kbintra-dev}
PROD_DATA_DIR=${PROD_DATA_DIR:-/root/kbintra-prod/data}

# Snapshot with sqlite's own backup, not by copying files. Prod's DB is hot:
# three containers write to it through a live WAL, so copying db.sqlite3 and
# its -wal one after the other captures them at different moments. That torn
# copy failed a migration on 2026-09-25 with foreign keys pointing at rows
# that "did not exist", while prod itself had none. The backup is a single
# consistent file, written to /tmp on prod (read-only on the DB itself) and
# removed again straight after.
SNAPSHOT=/tmp/kbintra-test-snapshot.sqlite3

echo ">>> Snapshotting prod DB on $PROD_REMOTE:$PROD_DATA_DIR (read-only)..."
mkdir -p ./data
trap 'ssh "$PROD_REMOTE" "rm -f $SNAPSHOT"' EXIT
ssh "$PROD_REMOTE" "sqlite3 -readonly '$PROD_DATA_DIR/db.sqlite3' '.backup $SNAPSHOT'"
rsync -avz "$PROD_REMOTE:$SNAPSHOT" ./data/db.sqlite3.new
ssh "$PROD_REMOTE" "rm -f $SNAPSHOT"
trap - EXIT

# The rsync below needs to own ./data/media to add prod's new files and --delete
# the test-only ones (e.g. expense_receipts uploaded while testing). Without
# sudo, a container does the chown, as root inside it.
#
# Which owner to ask for depends on the Docker daemon. Rootful: the container's
# root is the host's root, so the backend leaves root-owned files and we chown
# to our own uid. Rootless (thylakoid): the container's root *is* this deploy
# user on the host, and container uid N is a sub-uid (subuid start + N - 1).
# There, chowning to our own uid hands the files to that sub-uid instead: it
# left ./data/media owned by 363148 and rsync got "Permission denied" on every
# new prod file (2026-10-30). Root inside is us outside, so ask for 0:0.
#
# This runs while the app is still up, so the running backend can do it. The
# fallback (a brand-new box, or a stopped backend) is a one-off container on
# the deployed commit's image, the same way deploy.sh runs migrations.
echo ">>> Reclaiming ownership of ./data/media so rsync can write and --delete..."
mkdir -p ./data/media
if docker info -f '{{.SecurityOptions}}' 2>/dev/null | grep -q rootless; then
    OWNER=0:0
else
    OWNER="$(id -u):$(id -g)"
fi
if ! docker compose exec -T backend chown -R "$OWNER" /app/data/media 2>/dev/null; then
    IMAGE_TAG=$(git rev-parse HEAD) docker compose run --rm --no-deps -T \
        --entrypoint chown backend -R "$OWNER" /app/data/media \
        || echo "WARNING: could not chown ./data/media; rsync may fail on folders it does not own."
fi

# Media files (one-way: prod is SOURCE, local test is DEST).
# --delete removes files in ./data/media/ that are gone from prod; prod is never written to.
# Before the stop below, so a failure here leaves TEST running on its old data.
echo ">>> Rsyncing prod media from $PROD_REMOTE:$PROD_DATA_DIR/media/ (read-only)..."
rsync -avz --delete \
    "$PROD_REMOTE:$PROD_DATA_DIR/media/" \
    ./data/media/

# Swap the file in only while nothing here has it open. A running container
# holds the old database and its -wal; replacing them under it, it checkpointed
# its stale pages into the new file on shutdown and left it malformed
# (2026-09-25). deploy.sh starts the containers again.
echo ">>> Stopping the app containers to swap in the new database..."
docker compose stop backend backend-ws huey
mv ./data/db.sqlite3.new ./data/db.sqlite3
rm -f ./data/db.sqlite3-wal ./data/db.sqlite3-shm

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
