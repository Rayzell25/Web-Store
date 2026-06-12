# 🚀 Panduan Deploy Rayzell Store PPOB

## 🔁 Cara Lanjut di Antigravity (Akun Lain)

Ketik perintah ini di chat Antigravity akun baru:

```
@https://github.com/Rayzell25/web-store lanjutkan pengembangan project ini
```

Atau jika ingin langsung mengerjakan task tertentu:
```
@https://github.com/Rayzell25/web-store perbaiki bagian [sebutkan bagian]
```

> **Tips**: Antigravity akan otomatis clone repo dan melanjutkan dari state terakhir yang sudah di-push ke GitHub.

---

## 📋 Tahap 1 — Persiapan VPS

### 1.1 Update sistem
```bash
apt update && apt upgrade -y
```

### 1.2 Install Node.js 20 (LTS)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node --version   # pastikan v20.x
npm --version
```

### 1.3 Install PostgreSQL 16
```bash
apt install -y postgresql postgresql-contrib
systemctl enable postgresql
systemctl start postgresql
```

### 1.4 Install Redis
```bash
apt install -y redis-server
systemctl enable redis-server
systemctl start redis-server
redis-cli ping   # harus jawab PONG
```

### 1.5 Install Git & tools pendukung
```bash
apt install -y git curl wget unzip nginx certbot python3-certbot-nginx
```

### 1.6 Install PM2 (process manager)
```bash
npm install -g pm2
pm2 startup   # jalankan perintah yang muncul
```

---

## 📋 Tahap 2 — Setup Database PostgreSQL

```bash
# Masuk ke postgres
sudo -u postgres psql

# Di dalam psql:
CREATE USER ppob WITH PASSWORD 'GANTI_PASSWORD_KUAT_INI';
CREATE DATABASE ppob OWNER ppob;
GRANT ALL PRIVILEGES ON DATABASE ppob TO ppob;
\q
```

---

## 📋 Tahap 3 — Clone & Konfigurasi Aplikasi

### 3.1 Clone repo
```bash
mkdir -p /var/www
cd /var/www
git clone https://github.com/Rayzell25/web-store.git Web-Store
cd Web-Store/web-app
```

### 3.2 Install dependencies
```bash
npm install
```

### 3.3 Konfigurasi .env
```bash
cp .env.example .env
nano .env
```

**Isi wajib di .env:**
```env
# Telegram Bot
BOT_TOKEN=ISI_TOKEN_BOT_DARI_BOTFATHER
ADMIN_IDS=ISI_ID_TELEGRAM_KAMU

# Database
DATABASE_URL=postgres://ppob:GANTI_PASSWORD_KUAT_INI@127.0.0.1:5432/ppob

# Admin Panel Login
WEB_ADMIN_EMAIL=email_admin@domain.com
WEB_ADMIN_USER=admin
WEB_ADMIN_PASSWORD=PASSWORD_KUAT_BARU

# Digiflazz
DIGIFLAZZ_USERNAME=username_digiflazz
DIGIFLAZZ_API_KEY=api_key_digiflazz

# Web
STORE_NAME=Nama Toko Kamu
PUBLIC_URL=https://domain-kamu.com
WEB_PORT=3000
CONTACT_WA=08xxxxxxxxxx
CONTACT_TG=https://t.me/username_kamu
BOT_USERNAME=username_bot_tanpa_@
```

---

## 📋 Tahap 4 — Jalankan Aplikasi

### 4.1 Test manual dulu
```bash
# Test web server
node src/web/server.js
# Ctrl+C untuk stop setelah pastikan tidak ada error

# Test bot
node src/main.js
```

### 4.2 Jalankan via PM2
```bash
# Jalankan web server
pm2 start src/web/server.js --name "rayzell-web"

# Jalankan bot Telegram
pm2 start src/main.js --name "rayzell-bot"

# Save PM2 list agar auto-start saat reboot
pm2 save

# Cek status
pm2 status
pm2 logs rayzell-web
```

---

## 📋 Tahap 5 — Setup Nginx (Reverse Proxy)

### 5.1 Buat konfigurasi Nginx
```bash
nano /etc/nginx/sites-available/rayzell
```

Isi:
```nginx
server {
    listen 80;
    server_name domain-kamu.com www.domain-kamu.com;

    # Limit upload 10MB (untuk foto produk)
    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 5.2 Aktifkan site
```bash
ln -s /etc/nginx/sites-available/rayzell /etc/nginx/sites-enabled/
nginx -t   # pastikan tidak ada error
systemctl reload nginx
```

---

## 📋 Tahap 6 — SSL dengan Certbot (HTTPS)

```bash
# Pastikan domain sudah pointing ke IP VPS dulu!
certbot --nginx -d domain-kamu.com -d www.domain-kamu.com

# Isi email, setuju ToS, pilih redirect HTTP ke HTTPS
# Certbot otomatis update config Nginx

# Test auto-renewal
certbot renew --dry-run
```

---

## 📋 Tahap 7 — Akses Admin Panel

Buka browser: `https://domain-kamu.com/admin/`

Login dengan:
- **Email**: sesuai `WEB_ADMIN_EMAIL` di `.env`
- **Password**: sesuai `WEB_ADMIN_PASSWORD` di `.env`

---

## 🔧 Perintah Berguna

```bash
# Lihat log realtime
pm2 logs rayzell-web --lines 50
pm2 logs rayzell-bot --lines 50

# Restart aplikasi
pm2 restart rayzell-web
pm2 restart rayzell-bot
pm2 restart all

# Update dari GitHub
cd /var/www/Web-Store/web-app
git pull origin main
npm install
pm2 restart all

# Cek status semua service
pm2 status
systemctl status postgresql
systemctl status redis-server
systemctl status nginx

# Backup database manual
sudo -u postgres pg_dump ppob | gzip > /backup/ppob_$(date +%Y%m%d).sql.gz
```

---

## 🐳 Alternatif: Deploy via Docker

Jika VPS sudah ada Docker:

```bash
# Install Docker (jika belum)
curl -fsSL https://get.docker.com | bash

# Clone repo
git clone https://github.com/Rayzell25/web-store.git
cd web-store/web-app

# Edit .env
cp .env.example .env && nano .env

# Jalankan
docker-compose up -d

# Cek log
docker-compose logs -f
```

---

## ⚠️ Checklist Sebelum Go Live

- [ ] `BOT_TOKEN` sudah diisi (dari @BotFather)
- [ ] `ADMIN_IDS` sudah diisi (ID Telegram admin)
- [ ] `WEB_ADMIN_EMAIL` & `WEB_ADMIN_PASSWORD` sudah diganti dari default
- [ ] Password PostgreSQL sudah kuat
- [ ] SSL/HTTPS sudah aktif
- [ ] Domain sudah mengarah ke VPS
- [ ] `DIGIFLAZZ_USERNAME` & `DIGIFLAZZ_API_KEY` sudah diisi
- [ ] `PUBLIC_URL` sudah diisi dengan URL domain
- [ ] PM2 sudah di-save (`pm2 save`)
- [ ] Test beli produk berhasil
- [ ] Test admin panel bisa login

---

## 📞 Butuh Bantuan?

- Telegram: [@Rayzell23](https://t.me/Rayzell23)
- WhatsApp: [087826532525](https://wa.me/6287826532525)
