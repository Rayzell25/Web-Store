#!/usr/bin/env bash
#
# Restore database PPOB dari file backup .zip (atau .sql.gz lama).
# Pemakaian:
#   bash scripts/restore.sh backups/ppob-20260607-030000.zip
#
# PERINGATAN: ini menimpa data yang ada sekarang.
#
set -euo pipefail

FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Pemakaian: bash scripts/restore.sh <file-backup.zip>" >&2
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

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

case "$FILE" in
  *.zip)
    echo "[restore] ekstrak ZIP..."
    if [ -n "${BACKUP_ZIP_PASSWORD:-}" ]; then
      7z x -p"$BACKUP_ZIP_PASSWORD" -o"$TMPDIR" "$FILE" >/dev/null
    else
      7z x -o"$TMPDIR" "$FILE" >/dev/null
    fi
    SQL_FILE="$(find "$TMPDIR" -name '*.sql' | head -n1)"
    ;;
  *.sql.gz)
    echo "[restore] dekompres gz..."
    gunzip -c "$FILE" > "$TMPDIR/dump.sql"
    SQL_FILE="$TMPDIR/dump.sql"
    ;;
  *.sql)
    SQL_FILE="$FILE"
    ;;
  *)
    echo "Format tidak dikenali: $FILE" >&2; exit 1 ;;
esac

if [ -z "${SQL_FILE:-}" ] || [ ! -f "$SQL_FILE" ]; then
  echo "ERROR: file .sql tidak ditemukan dalam arsip." >&2
  exit 1
fi

echo "[restore] memulihkan ke database '$PGDATABASE'..."
docker exec -i "$CONTAINER" psql -U "$PGUSER" -d "$PGDATABASE" < "$SQL_FILE"
echo "[restore] selesai."
