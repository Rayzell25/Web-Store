#!/usr/bin/env bash
#
# Setup web storefront: systemd service + Nginx reverse proxy + SSL (Let's Encrypt).
# Jalankan SETELAH domain di-pointing ke IP VPS (lihat panduan di README).
#
# Pemakaian:
#   sudo bash scripts/setup-web.sh rayzelldigital.web.id
#   (kalau domain dikosongkan, dipakai PUBLIC_URL dari .env)
#
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*" >&2; }

if [ "${EUID:-$(id -u)}" -ne 0 ]; then err "Jalankan sebagai root: sudo bash scripts/setup-web.sh <domain>"; exit 1; fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

[ -f .env ] && { set -a; . ./.env; set +a; }

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  DOMAIN="$(echo "${PUBLIC_URL:-}" | sed -E 's#^https?://##; s#/.*$##')"
fi
if [ -z "$DOMAIN" ]; then err "Domain tidak diberikan. Contoh: sudo bash scripts/setup-web.sh rayzelldigital.web.id"; exit 1; fi
WEB_PORT="${WEB_PORT:-3000}"
NODE_BIN="$(command -v node)"

log "Domain   : $DOMAIN"
log "Web port : $WEB_PORT"

# 1) paket
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y nginx certbot python3-certbot-nginx

# 2) systemd service web
cat >/etc/systemd/system/rayzell-web.service <<EOF
[Unit]
Description=Rayzell Store PPOB Web
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${PROJECT_DIR}
ExecStart=${NODE_BIN} ${PROJECT_DIR}/src/web/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable rayzell-web >/dev/null 2>&1 || true
systemctl restart rayzell-web
log "Service rayzell-web jalan."

# 3) nginx reverse proxy
cat >/etc/nginx/sites-available/rayzell <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${WEB_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
ln -sf /etc/nginx/sites-available/rayzell /etc/nginx/sites-enabled/rayzell
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t && systemctl reload nginx
log "Nginx terpasang untuk $DOMAIN."

# 4) SSL Let's Encrypt
if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect --register-unsafely-without-email; then
  log "SSL aktif (HTTPS)."
else
  warn "SSL gagal. Pastikan domain '$DOMAIN' sudah pointing ke IP VPS ini, lalu ulangi:"
  warn "  certbot --nginx -d $DOMAIN"
fi

echo
log "SELESAI. Buka: https://${DOMAIN}"
echo " Status web : systemctl status rayzell-web"
echo " Log web    : journalctl -u rayzell-web -f"
