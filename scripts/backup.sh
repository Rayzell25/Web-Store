#!/usr/bin/env bash
#
# Backup database PostgreSQL bot PPOB, lalu kirim ke Telegram (offsite).
# Aman dari kegagalan/suspend VPS karena salinan ada di chat Telegram kamu.
#
# Pemakaian:
#   bash scripts/backup.sh
#
# Cron harian (jam 03:00):
#   0 3 * * * cd /root/ppob && bash scripts/backup.sh >> /root/ppob/backup.log 2>&1
#
set -euo pipefail

# --- pindah ke root project (folder berisi .env) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# --- muat .env ---
if [ ! -f .env ]; then
  echo "ERROR: .env tidak ditemukan di $PROJECT_DIR" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
. ./.env
set +a

PGUSER="${PGUSER:-ppob}"
PGDATABASE="${PGDATABASE:-ppob}"
CONTAINER="${PG_CONTAINER:-ppob-postgres}"
BACKUP_DIR="$PROJECT_DIR/backups"
KEEP="${BACKUP_KEEP:-14}"   # simpan N backup terakhir di lokal

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/ppob-$STAMP.sql.gz"

echo "[backup] dump database '$PGDATABASE' dari container '$CONTAINER'..."
docker exec -t "$CONTAINER" pg_dump -U "$PGUSER" "$PGDATABASE" | gzip > "$OUT"

SIZE="$(du -h "$OUT" | cut -f1)"
echo "[backup] selesai: $OUT ($SIZE)"

# --- kirim ke Telegram (offsite) ---
if [ -n "${BOT_TOKEN:-}" ] && [ -n "${BACKUP_CHAT_ID:-}" ]; then
  echo "[backup] mengirim ke Telegram chat $BACKUP_CHAT_ID..."
  HTTP_CODE="$(curl -s -o /tmp/tg_backup_resp -w '%{http_code}' \
    -F chat_id="$BACKUP_CHAT_ID" \
    -F document=@"$OUT" \
    -F caption="🗄 Backup PPOB
Tanggal: $STAMP
Ukuran: $SIZE" \
    "https://api.telegram.org/bot$BOT_TOKEN/sendDocument" || echo 000)"
  if [ "$HTTP_CODE" = "200" ]; then
    echo "[backup] terkirim ke Telegram."
  else
    echo "[backup] GAGAL kirim ke Telegram (HTTP $HTTP_CODE):" >&2
    cat /tmp/tg_backup_resp >&2 || true
    echo >&2
  fi
else
  echo "[backup] BOT_TOKEN / BACKUP_CHAT_ID kosong -> lewati kirim Telegram."
fi

# --- rotasi: simpan N terbaru saja ---
ls -1t "$BACKUP_DIR"/ppob-*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
echo "[backup] rotasi selesai (simpan $KEEP terbaru)."
