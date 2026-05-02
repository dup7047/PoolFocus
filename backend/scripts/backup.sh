#!/usr/bin/env bash
# Take a custom-format pg_dump of $DATABASE_URL into ./tmp/.
# This is the local-dev companion to Railway's managed backups (see RUNBOOK).
set -euo pipefail

URL="${DATABASE_URL:?DATABASE_URL not set}"
DB="${URL##*/}"
DB="${DB%%\?*}"
OUT_DIR="${OUT_DIR:-./tmp}"
mkdir -p "$OUT_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="${OUT_DIR}/${DB}-${STAMP}.dump"

pg_dump --format=custom --no-owner --no-acl --file="$OUT" "$URL"
echo "Wrote $OUT ($(du -h "$OUT" | cut -f1))"
