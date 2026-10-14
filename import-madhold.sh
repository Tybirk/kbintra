#!/bin/sh
# Put a published madhold plan (the noticeboard PDF) into the app on a server.
#
#   KBINTRA_HOST=root@prod-box ./import-madhold.sh ~/Downloads/madhold-september-oktober-2026.pdf
#   KBINTRA_HOST=root@prod-box ./import-madhold.sh ~/Downloads/madhold-september-oktober-2026.pdf --apply
#
# The same script takes the organiser's all_persons.csv (pause, reason, chefkok,
# medbeboer) and runs import_food_flags instead:
#
#   KBINTRA_HOST=root@prod-box ./import-madhold.sh ~/Desktop/madhold/all_persons.csv --apply
#
# Without --apply this is a dry run: every name is looked up on the server and
# reported, nothing is written. Add --replace (with --apply) only when the
# importer says teams already exist on some of the dates.
#
# Steps: pdftotext locally -> prepend '# år: YYYY' -> scp to
# $REMOTE_DIR/data/madhold-import.txt (bind-mounted as /app/data in the backend
# container) -> run manage.py import_food_teams in the backend container.
#
# The import itself sends no notifications. Once teams exist, the 20:00 reminder
# the evening before each upcoming day does (see docs/madhold-go-live.md).
#
# Test server: REMOTE_DIR=/opt/kbintra-test2. deploy-test.sh replays the same
# data/madhold-import.txt after every deploy, so the plan survives the prod-DB copy.
set -e

: "${KBINTRA_HOST:?Set KBINTRA_HOST to the ssh target, e.g. root@1.2.3.4 or an ssh alias}"
REMOTE_DIR=${REMOTE_DIR:-/root/kbintra-prod}

SOURCE=$1
[ -n "$SOURCE" ] && [ -f "$SOURCE" ] || {
    echo "Usage: KBINTRA_HOST=... $0 <plan.pdf|plan.txt|all_persons.csv> [--apply] [--replace]" >&2
    exit 1
}
shift

APPLY=0
REPLACE=""
for arg in "$@"; do
    case "$arg" in
        --apply) APPLY=1 ;;
        --replace) REPLACE="--replace" ;;
        *) echo "Unknown option: $arg" >&2; exit 1 ;;
    esac
done
if [ -n "$REPLACE" ] && [ "$APPLY" -eq 0 ]; then
    echo "--replace only means something together with --apply." >&2
    exit 1
fi

REMOTE="docker compose -f $REMOTE_DIR/docker-compose.yml exec -T backend uv run python manage.py"

case "$SOURCE" in
    *.csv)
        [ -z "$REPLACE" ] || { echo "--replace is for the plan, not the CSV." >&2; exit 1; }
        echo ">>> Copying $SOURCE to $KBINTRA_HOST:$REMOTE_DIR/data/all_persons.csv"
        scp -q "$SOURCE" "$KBINTRA_HOST:$REMOTE_DIR/data/all_persons.csv"
        if [ "$APPLY" -eq 1 ]; then
            ssh "$KBINTRA_HOST" "$REMOTE import_food_flags /app/data/all_persons.csv --apply"
        else
            ssh "$KBINTRA_HOST" "$REMOTE import_food_flags /app/data/all_persons.csv"
        fi
        exit 0
        ;;
esac

# The list gives day/month only; the year comes from YEAR or the file name.
YEAR=${YEAR:-$(basename "$SOURCE" | grep -oE '20[0-9]{2}' | head -1)}
[ -n "$YEAR" ] || { echo "Could not find a year in the file name; set YEAR=2026." >&2; exit 1; }

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
echo "# år: $YEAR" > "$TMP"
case "$SOURCE" in
    *.pdf) pdftotext -layout "$SOURCE" - >> "$TMP" ;;
    *) grep -v '^# *år' "$SOURCE" >> "$TMP" ;;
esac

echo ">>> Plan read from $SOURCE (year $YEAR):"
grep -iE '^(mandag|tirsdag|onsdag|torsdag|fredag) ' "$TMP" | sed 's/^/    /'

REMOTE_FILE=$REMOTE_DIR/data/madhold-import.txt
echo ">>> Copying to $KBINTRA_HOST:$REMOTE_FILE"
scp -q "$TMP" "$KBINTRA_HOST:$REMOTE_FILE"

COMPOSE="$REMOTE import_food_teams /app/data/madhold-import.txt"
if [ "$APPLY" -eq 1 ]; then
    echo ">>> Importing for real on $KBINTRA_HOST"
    ssh "$KBINTRA_HOST" "$COMPOSE $REPLACE"
else
    echo ">>> Dry run on $KBINTRA_HOST (nothing is written)"
    ssh "$KBINTRA_HOST" "$COMPOSE --dry-run"
    echo ""
    echo "All names resolved? Re-run with --apply to import."
fi
