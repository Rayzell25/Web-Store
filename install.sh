#!/usr/bin/env bash
#
# Installer sekali jalan untuk Rayzell Store PPOB di VPS FRESH.
# Support: Ubuntu 20.04 / 22.04 / 24.04, Debian 10 / 11 / 12.
#
# Pemakaian:
#   sudo bash install.sh
#
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*" >&2; }
step() { echo -e "\n${BLUE}==>${NC} ${1}"; }

# ===== 0. cek root & OS =====
if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  err "Jalankan sebagai root:  sudo bash install.sh"
  exit 1
fi

if [ ! -f /etc/os-release ]; then
  err "Tidak bisa deteksi OS (/etc/os-release tidak ada)."
  exit 1
fi
. /etc/os-release
OS_ID="${ID:-}"; OS_VER="${VERSION_ID:-}"
case "$OS_ID" in
  ubuntu)
    case "$OS_VER" in 20.04|22.04|24.04) ;; *) warn "Ubuntu $OS_VER belum diuji, lanjut saja." ;; esac ;;
  debian)
    case "$OS_VER" in 10|11|12) ;; *) warn "Debian $OS_VER belum diuji, lanjut saja." ;; esac ;;
  *)
    err "OS '$OS_ID' tidak didukung. Hanya Ubuntu 20/22/24 & Debian 10/11/12."
    exit 1 ;;
esac
log "OS terdeteksi: $PRETTY_NAME"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ===== 1. update sistem =====
step "Update & upgrade sistem (apt)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y

# ===== 2. paket dasar =====
step "Install paket dasar (curl, git, zip, p7zip, cron, openssl)"
apt-get install -y curl ca-certificates gnupg git unzip zip p7zip-full cron openssl

# ===== 3. Docker =====
step "Install Docker + Compose"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${OS_ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME:-focal}")"
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${OS_ID} ${CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  # catatan: TIDAK memasang docker-model-plugin (tidak tersedia di Ubuntu focal/EOL)
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin docker-buildx-plugin
else
  log "Docker sudah ada, lewati."
fi
systemctl enable --now docker

# ===== 4. Redis =====
step "Install Redis"
apt-get install -y redis-server
systemctl enable --now redis-server

# ===== 5. Node.js 20 =====
step "Install Node.js 20"
NODE_MAJOR="$(command -v node >/dev/null 2>&1 && node -p 'process.versions.node.split(".")[0]' || echo 0)"
if [ "${NODE_MAJOR:-0}" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  log "Node.js v$(node -v) sudah memadai, lewati."
fi

# ===== 6. dependency bot =====
step "Install dependency Node (npm install)"
npm install --omit=dev --no-audit --no-fund

# ===== 7. siapkan .env =====
step "Menyiapkan konfigurasi (.env)"
[ -f .env ] || cp .env.example .env

set_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    echo "${key}=${val}" >> .env
  fi
}
get_env() { grep "^$1=" .env | head -n1 | cut -d= -f2- || true; }

PGUSER_V="$(get_env PGUSER)"; PGUSER_V="${PGUSER_V:-ppob}"
PGDB_V="$(get_env PGDATABASE)"; PGDB_V="${PGDB_V:-ppob}"

# password Postgres: generate kalau kosong / masih placeholder
PGPASS_V="$(get_env PGPASSWORD)"
if [ -z "$PGPASS_V" ] || echo "$PGPASS_V" | grep -qi 'GANTI'; then
  PGPASS_V="$(openssl rand -hex 16)"
  log "Password PostgreSQL di-generate otomatis."
fi
set_env PGUSER "$PGUSER_V"
set_env PGDATABASE "$PGDB_V"
set_env PGPASSWORD "$PGPASS_V"
set_env DATABASE_URL "postgres://${PGUSER_V}:${PGPASS_V}@127.0.0.1:5432/${PGDB_V}"

# password ZIP backup: generate kalau kosong
BZP_V="$(get_env BACKUP_ZIP_PASSWORD)"
if [ -z "$BZP_V" ]; then
  BZP_V="$(openssl rand -hex 12)"
  set_env BACKUP_ZIP_PASSWORD "$BZP_V"
  log "Password ZIP backup di-generate otomatis."
fi

# ===== 8. jalankan container (Postgres + Local Bot API) =====
step "Menjalankan PostgreSQL + Local Bot API (docker compose)"
# Tarik image terbaru dulu. WAJIB: Local Bot API harus versi 9.4+ supaya
# custom/premium emoji di tombol (icon_custom_emoji_id) dikenali server.
# Tanpa pull, install ulang di VPS lama akan tetap pakai image basi -> emoji
# premium tidak muncul.
log "Menarik image terbaru (termasuk Local Bot API 9.4+)..."
docker compose pull || warn "docker compose pull gagal (lanjut pakai image yang ada)."
docker compose up -d

log "Menunggu PostgreSQL siap..."
for i in $(seq 1 30); do
  if docker exec ppob-postgres pg_isready -U "$PGUSER_V" -d "$PGDB_V" >/dev/null 2>&1; then
    log "PostgreSQL siap."; break
  fi
  sleep 2
  [ "$i" -eq 30 ] && warn "PostgreSQL belum siap, cek: docker compose logs postgres"
done

# ===== 9. cron backup harian =====
step "Memasang cron backup harian (03:00)"
# Pastikan daemon cron aktif (kalau tidak, jadwal 03:00 tidak akan jalan).
systemctl enable --now cron 2>/dev/null || systemctl enable --now crond 2>/dev/null || warn "Gagal enable cron, cek manual: systemctl status cron"
chmod +x scripts/*.sh 2>/dev/null || true
CRON_LINE="0 3 * * * cd ${SCRIPT_DIR} && bash scripts/backup.sh >> ${SCRIPT_DIR}/backup.log 2>&1"
TMPCRON="$(mktemp)"
crontab -l 2>/dev/null | grep -v 'scripts/backup.sh' > "$TMPCRON" || true
echo "$CRON_LINE" >> "$TMPCRON"
crontab "$TMPCRON" 2>/dev/null || warn "Gagal pasang cron (lewati, bisa dipasang manual nanti)."
rm -f "$TMPCRON"
log "Cron terpasang."

# ===== 10. systemd service =====
step "Mendaftarkan service systemd (auto-start + auto-restart)"
NODE_BIN="$(command -v node)"
cat >/etc/systemd/system/rayzell-ppob.service <<EOF
[Unit]
Description=Rayzell Store PPOB Bot
After=network-online.target docker.service redis-server.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${SCRIPT_DIR}
ExecStart=${NODE_BIN} ${SCRIPT_DIR}/src/main.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable rayzell-ppob >/dev/null 2>&1 || true

# ===== 11. prompt konfigurasi (3) =====
echo
echo "═══════════════════════════════════════════"
echo "   SETUP RAYZELL STORE PPOB"
echo "═══════════════════════════════════════════"
read -rp "Token bot          : " IN_BOT_TOKEN </dev/tty
read -rp "ID owner           : " IN_OWNER_ID </dev/tty
read -rp "ID channel / grup  : " IN_BACKUP_CHAT </dev/tty
echo "═══════════════════════════════════════════"

[ -n "${IN_BOT_TOKEN:-}" ]   && set_env BOT_TOKEN "$IN_BOT_TOKEN" || true
[ -n "${IN_OWNER_ID:-}" ]    && set_env ADMIN_IDS "$IN_OWNER_ID" || true
[ -n "${IN_BACKUP_CHAT:-}" ] && set_env BACKUP_CHAT_ID "$IN_BACKUP_CHAT" || true

# ===== 12. start bot =====
step "Menjalankan bot"
systemctl restart rayzell-ppob || warn "Bot gagal start, cek: journalctl -u rayzell-ppob -n 50"

sleep 2
echo
echo "═══════════════════════════════════════════"
log  "INSTALASI SELESAI"
echo "═══════════════════════════════════════════"
echo " Status bot   : systemctl status rayzell-ppob"
echo " Log bot      : journalctl -u rayzell-ppob -f"
echo " Container    : docker compose ps"
echo
echo " Password DB        : ${PGPASS_V}"
echo " Password ZIP backup: ${BZP_V}"
warn "SIMPAN 2 password di atas! (password ZIP dipakai untuk membuka file backup)"
echo
warn "Credentials berikut diisi manual di .env lalu: systemctl restart rayzell-ppob"
echo "   - DIGIFLAZZ_USERNAME / DIGIFLAZZ_API_KEY  (provider produk)"
echo "   - AUTOGOPAY_API_KEY                       (pembayaran QRIS)"
echo "   - BOT_USERNAME                            (username bot tanpa @)"
echo "   (Backup otomatis menggunakan BOT_TOKEN yang sudah diisi di atas)"
echo
echo " Langkah berikutnya: buka bot di Telegram -> /start"
echo "═══════════════════════════════════════════"
