#!/usr/bin/env bash
# Restore drill: dump the current DB, restore it into a scratch DB, run
# sanity checks, drop the scratch DB. Used to verify backups are usable
# end-to-end. See RUNBOOK.md.
#
# Usage:
#   SOURCE_URL=postgres://user:pass@host:5432/db ./scripts/restore-drill.sh
#   (or rely on DATABASE_URL from .env)
set -euo pipefail

SOURCE_URL="${SOURCE_URL:-${DATABASE_URL:-}}"
if [[ -z "$SOURCE_URL" ]]; then
  echo "ERROR: set SOURCE_URL or DATABASE_URL" >&2
  exit 1
fi

# Parse out admin connection (postgres DB) for CREATE/DROP DATABASE.
# Strip the trailing /<dbname> to get the cluster URL.
CLUSTER_URL="${SOURCE_URL%/*}"
SOURCE_DB="${SOURCE_URL##*/}"
SOURCE_DB="${SOURCE_DB%%\?*}"  # strip query string if present
SCRATCH_DB="restore_drill_$(date -u +%Y%m%d_%H%M%S)"
ADMIN_URL="${CLUSTER_URL}/postgres"

DUMP_DIR="${DUMP_DIR:-./tmp}"
mkdir -p "$DUMP_DIR"
DUMP_FILE="${DUMP_DIR}/${SOURCE_DB}.dump"

START_TS=$(date +%s)

echo "[1/5] pg_dump ${SOURCE_DB} → ${DUMP_FILE}"
pg_dump --format=custom --no-owner --no-acl --file="$DUMP_FILE" "$SOURCE_URL"

echo "[2/5] CREATE DATABASE ${SCRATCH_DB}"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${SCRATCH_DB}\";"

cleanup() {
  echo "[cleanup] DROP DATABASE ${SCRATCH_DB}"
  psql "$ADMIN_URL" -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS \"${SCRATCH_DB}\" WITH (FORCE);" \
    || echo "[cleanup] WARNING: drop failed; clean up manually"
}
trap cleanup EXIT

echo "[3/5] pg_restore → ${SCRATCH_DB}"
pg_restore --no-owner --no-acl --dbname="${CLUSTER_URL}/${SCRATCH_DB}" "$DUMP_FILE"

echo "[4/5] Sanity checks"
SCRATCH_URL="${CLUSTER_URL}/${SCRATCH_DB}"
EXPECTED_TABLES=(users devices pools pool_members pool_invites challenge_days challenge_entries screen_time_events)
for table in "${EXPECTED_TABLES[@]}"; do
  count=$(psql "$SCRATCH_URL" -tAc "SELECT count(*) FROM \"${table}\";")
  printf "  %-22s rows=%s\n" "$table" "$count"
done

# Spot-check that an entry round-trip works in the restored DB:
# upsert dedupe trigger on screen_time_events should still be enforced.
echo "  unique-index check…"
psql "$SCRATCH_URL" -tAc "SELECT indexname FROM pg_indexes WHERE indexname='screen_time_events_entry_client_event_unique';" \
  | grep -q "screen_time_events_entry_client_event_unique" \
  && echo "    OK: dedupe index present"

echo "  trigger check…"
psql "$SCRATCH_URL" -tAc "SELECT trigger_name FROM information_schema.triggers WHERE trigger_name='challenge_entries_set_updated_at';" \
  | grep -q "challenge_entries_set_updated_at" \
  && echo "    OK: updated_at trigger present"

END_TS=$(date +%s)
ELAPSED=$((END_TS - START_TS))
echo "[5/5] Restore drill completed in ${ELAPSED}s"

if (( ELAPSED > 900 )); then
  echo "WARNING: restore drill took longer than the 15-minute SLO" >&2
  exit 2
fi
