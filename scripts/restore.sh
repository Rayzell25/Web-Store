#!/usr/bin/env bash
#
# Restore database PPOB dari file backup .sql.gz.
# Pemakaian:
#   bash scripts/restore.sh backups/ppob-20260606-030000.sql.gz
#
# PERINGATAN: ini menimpa data yang ada sekarang. Pastikan file benar.
#
set -euo pipefail

FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Pemakaian: bash scripts/restore.sh <file-backup.sql.gz>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

set -a
# shellcheck disable=SC1091
. ./.env
set +a

PGUSER="${PGUSER:-ppob}"
PGDATABASE="${PGDATABASE:-ppob}"
CONTAINER="${PG_CONTAINER:-ppob-postgres}"

echo "[restore] memulihkan '$FILE' ke database '$PGDATABASE'..."
gunzip -c "$FILE" | docker exec -i "$CONTAINER" psql -U "$PGUSER" -d "$PGDATABASE"
echo "[restore] selesai."
