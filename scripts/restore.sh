#!/usr/bin/env bash
#
# Restore database PPOB dari file backup .zip (atau .sql).
#
# Pemakaian:
#   bash scripts/restore.sh backups/ppob-20260607-030000.zip
#
# PERINGATAN: ini menimpa data yang ada sekarang.
#
set -euo pipefail

FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Pemakaian: bash scripts/restore.sh <file-backup.zip>" >&2; exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

if [ ! -f .env ]; then
  echo "ERROR: .env tidak ditemukan." >&2; exit 1
fi

# Baca .env pakai grep — aman, tidak di-source
get_env() { grep -m1 "^${1}=" .env 2>/dev/null | cut -d= -f2- || true; }

PGUSER="$(get_env PGUSER)";                  PGUSER="${PGUSER:-ppob}"
PGDATABASE="$(get_env PGDATABASE)";          PGDATABASE="${PGDATABASE:-ppob}"
CONTAINER="$(get_env PG_CONTAINER)";         CONTAINER="${CONTAINER:-ppob-postgres}"
BACKUP_ZIP_PASSWORD="$(get_env BACKUP_ZIP_PASSWORD)"

TMPDIR_WORK="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_WORK"' EXIT

case "$FILE" in
  *.zip)
    echo "[restore] ekstrak ZIP..."
    if [ -n "$BACKUP_ZIP_PASSWORD" ]; then
      7z x -p"$BACKUP_ZIP_PASSWORD" -o"$TMPDIR_WORK" "$FILE" >/dev/null
    else
      7z x -o"$TMPDIR_WORK" "$FILE" >/dev/null
    fi
    SQL_FILE="$(find "$TMPDIR_WORK" -name '*.sql' | head -n1)"
    ;;
  *.sql)
    SQL_FILE="$FILE"
    ;;
  *)
    echo "Format tidak dikenali: $FILE" >&2; exit 1 ;;
esac

if [ -z "${SQL_FILE:-}" ] || [ ! -f "$SQL_FILE" ]; then
  echo "ERROR: file .sql tidak ditemukan dalam arsip." >&2; exit 1
fi

echo "[restore] memulihkan ke database '$PGDATABASE'..."
docker exec -i "$CONTAINER" psql -U "$PGUSER" -d "$PGDATABASE" < "$SQL_FILE"
echo "[restore] selesai."
