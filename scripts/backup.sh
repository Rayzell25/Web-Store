#!/usr/bin/env bash
#
# Backup database PostgreSQL bot PPOB -> .zip ber-password -> kirim ke Telegram (offsite).
#
# Pemakaian:
#   bash scripts/backup.sh
#
# Cron harian (jam 03:00) dipasang otomatis oleh install.sh:
#   0 3 * * * cd /root/ppob && bash scripts/backup.sh >> /root/ppob/backup.log 2>&1
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

if [ ! -f .env ]; then
  echo "ERROR: .env tidak ditemukan di $PROJECT_DIR" >&2; exit 1
fi

# Baca .env pakai grep — aman, tidak di-source (value dengan spasi tidak error)
get_env() { grep -m1 "^${1}=" .env 2>/dev/null | cut -d= -f2- || true; }

PGUSER="$(get_env PGUSER)";              PGUSER="${PGUSER:-ppob}"
PGDATABASE="$(get_env PGDATABASE)";      PGDATABASE="${PGDATABASE:-ppob}"
CONTAINER="$(get_env PG_CONTAINER)";     CONTAINER="${CONTAINER:-ppob-postgres}"
BACKUP_ZIP_PASSWORD="$(get_env BACKUP_ZIP_PASSWORD)"
BACKUP_BOT_TOKEN="$(get_env BACKUP_BOT_TOKEN)"
BOT_TOKEN="$(get_env BOT_TOKEN)"
BACKUP_CHAT_ID="$(get_env BACKUP_CHAT_ID)"
BACKUP_KEEP="$(get_env BACKUP_KEEP)";    BACKUP_KEEP="${BACKUP_KEEP:-14}"

BACKUP_DIR="$PROJECT_DIR/backups"
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
SQL_TMP="$BACKUP_DIR/ppob-$STAMP.sql"
OUT="$BACKUP_DIR/ppob-$STAMP.zip"

echo "[backup] dump database '$PGDATABASE'..."
docker exec -t "$CONTAINER" pg_dump -U "$PGUSER" "$PGDATABASE" > "$SQL_TMP"

echo "[backup] kompres ke ZIP..."
if [ -n "$BACKUP_ZIP_PASSWORD" ]; then
  7z a -tzip -mem=AES256 -p"$BACKUP_ZIP_PASSWORD" "$OUT" "$SQL_TMP" >/dev/null
  echo "[backup] ZIP ber-password (AES-256) dibuat."
else
  zip -j -q "$OUT" "$SQL_TMP"
  echo "[backup] ZIP tanpa password (BACKUP_ZIP_PASSWORD kosong)."
fi
rm -f "$SQL_TMP"

SIZE="$(du -h "$OUT" | cut -f1)"
echo "[backup] selesai: $OUT ($SIZE)"

# Kirim ke Telegram via bot backup (fallback BOT_TOKEN)
TG_TOKEN="${BACKUP_BOT_TOKEN:-$BOT_TOKEN}"
if [ -n "$TG_TOKEN" ] && [ -n "$BACKUP_CHAT_ID" ]; then
  echo "[backup] mengirim ke Telegram (chat $BACKUP_CHAT_ID)..."
  HTTP_CODE="$(curl -s -o /tmp/tg_backup_resp -w '%{http_code}' \
    -F chat_id="$BACKUP_CHAT_ID" \
    -F document=@"$OUT" \
    -F caption="Backup PPOB
Tanggal: $STAMP
Ukuran: $SIZE" \
    "https://api.telegram.org/bot$TG_TOKEN/sendDocument" || echo 000)"
  if [ "$HTTP_CODE" = "200" ]; then
    echo "[backup] terkirim ke Telegram."
  else
    echo "[backup] GAGAL kirim ke Telegram (HTTP $HTTP_CODE):" >&2
    cat /tmp/tg_backup_resp >&2 || true; echo >&2
  fi
else
  echo "[backup] BACKUP_CHAT_ID atau token kosong -> lewati kirim."
fi

# Rotasi: simpan N terbaru
ls -1t "$BACKUP_DIR"/ppob-*.zip 2>/dev/null | tail -n +"$((BACKUP_KEEP + 1))" | xargs -r rm -f
echo "[backup] rotasi selesai (simpan $BACKUP_KEEP terbaru)."
