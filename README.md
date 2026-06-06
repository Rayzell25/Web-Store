# Cho Store PPOB Bot

Bot Telegram PPOB lengkap (pulsa, paket data, token PLN, voucher game, e-money) dengan integrasi **Digiflazz**, sistem saldo & deposit, **markup fleksibel**, database **PostgreSQL** + **backup harian otomatis ke Telegram**, cache session **Redis**, dan dukungan **Telegram Local Bot API** untuk respons tombol super cepat.

## Fitur

- 🛒 **Beli Paket** (`order.js`) — kategori → brand → produk → nomor tujuan → konfirmasi → bayar.
- 💰 **Saldo / Top Up** (`deposit.js`) — buat deposit, transfer manual, approve/tolak admin.
- 📦 **Cek Stok** (`stok.js`) — lihat daftar produk + harga jual tanpa beli.
- 📜 **Riwayat** (`riwayat.js`) — 10 transaksi terakhir + SN.
- 🧰 **Tools** (`tools.js`) — cek operator dari nomor HP.
- ❓ **Bantuan** (`help.js`).
- ⚙️ **Panel Admin** (`admin.js`) — statistik, approve deposit, saldo manual, set role, **atur markup**, sync produk, broadcast.
- 🔁 Refund otomatis jika transaksi ke provider gagal.
- 🛡 **Data aman**: PostgreSQL + mutasi saldo atomik (`SELECT ... FOR UPDATE`) + **backup harian dikirim ke Telegram** (offsite, selamat walau VPS error/suspend).

## Markup / Keuntungan (fleksibel)

Untung kamu = selisih **harga jual − harga modal Digiflazz**. Markup bisa diatur dari bot (Admin → 🏷 Markup) dengan prioritas:

1. **Override per produk** (paling diutamakan)
2. **Markup per kategori**
3. **Default per role** (MEMBER / RESELLER)

Tipe markup: `flat` (rupiah) atau `percent` (% dari modal), plus pembulatan. Contoh perintah:

```
default|flat|500
default|percent|3
reseller|flat|250
cat|Paket Data|flat|1000
cat|PLN|flat|1500
sku|xld10|flat|800
round|100
delcat|Paket Data
delsku|xld10
```

## Arsitektur

```
src/
├── main.js                 # entry point + router semua handler
├── config.js               # baca .env (tanpa literal rahasia)
├── cache/redis.js          # koneksi Redis (opsional)
├── db/database.js          # PostgreSQL (pg Pool): one/all/query/withTx
├── services/
│   ├── digiflazz.js        # API Digiflazz
│   ├── userService.js      # user & saldo
│   ├── trxService.js       # transaksi
│   ├── depositService.js   # deposit/top up
│   ├── productService.js   # produk
│   └── markupService.js    # markup fleksibel
├── handlers/               # 1 fitur = 1 file
│   ├── start.js  order.js  deposit.js  stok.js
│   ├── riwayat.js  tools.js  help.js  admin.js
├── keyboards/menus.js
└── utils/                  # logger, format, session(redis), registry
```

> Data sensitif (token, API key, `api_id`, `api_hash`) **hanya** di `.env` (gitignored).

## Setup VPS

```bash
# 1) Docker (untuk PostgreSQL & Local Bot API)
curl -fsSL https://get.docker.com | bash

# 2) Redis (cache session)
apt install redis-server -y && systemctl enable --now redis

# 3) Ambil kode + siapkan .env
git clone <repo-url> && cd ppob
cp .env.example .env
nano .env   # WAJIB: isi BOT_TOKEN, ADMIN_IDS, PGPASSWORD/DATABASE_URL, DIGIFLAZZ_*, BACKUP_CHAT_ID

# 4) Jalankan PostgreSQL (data permanen di volume, hanya dengar di localhost)
docker compose up -d
#   cek: docker compose ps  (status harus healthy)

# 5) Local Bot API (opsional, biar tombol cepat - ganti API_ID & API_HASH)
docker run -d --name telegram-bot-api --restart always \
  -p 127.0.0.1:8081:8081 \
  -e TELEGRAM_API_ID=API_ID_KAMU \
  -e TELEGRAM_API_HASH=API_HASH_KAMU \
  -e TELEGRAM_LOCAL=1 \
  -v /root/bot-api-data:/var/lib/telegram-bot-api \
  -v /root/bot-api-temp:/tmp/telegram-bot-api \
  aiogram/telegram-bot-api:latest

# 6) Install dependency Node & jalankan bot
npm install
npm start
```

> `DATABASE_URL` di `.env` harus cocok dengan `PGUSER`/`PGPASSWORD`/`PGDATABASE` yang dipakai `docker compose`.
> Kalau `BOT_API_ROOT`/`REDIS_URL` dikosongkan, bot tetap jalan (server resmi Telegram + session in-memory).

## 🛡 Backup otomatis (PENTING — biar saldo/riwayat tidak hilang)

Backup tiap hari: `pg_dump` lalu file dikirim ke **bot Telegram khusus backup** (offsite). Walau VPS hilang, data tetap bisa dipulihkan.

```bash
# 1) Buat bot baru KHUSUS backup di @BotFather, salin tokennya ke .env -> BACKUP_BOT_TOKEN
# 2) Chat/start bot backup itu, lalu set BACKUP_CHAT_ID (ID kamu - lihat /id, atau ID channel privat)
# 3) Tes manual:
bash scripts/backup.sh

# Pasang cron harian jam 03:00 (sesuaikan path project):
crontab -e
# tambahkan baris:
0 3 * * * cd /root/ppob && bash scripts/backup.sh >> /root/ppob/backup.log 2>&1
```

> File backup dikirim lewat `BACKUP_BOT_TOKEN` (kalau diisi). Jadi bot jualan dan bot backup terpisah. Kalau `BACKUP_BOT_TOKEN` kosong, fallback pakai `BOT_TOKEN`.

Pulihkan dari backup (menimpa data sekarang):

```bash
bash scripts/restore.sh backups/ppob-YYYYMMDD-HHMMSS.sql.gz
```

## Konfigurasi (.env)

| Variabel | Wajib | Keterangan |
|---|---|---|
| `BOT_TOKEN` | ✅ | Token dari @BotFather |
| `ADMIN_IDS` | ✅ | ID admin, pisah koma |
| `DATABASE_URL` | ✅ | Koneksi Postgres, mis. `postgres://ppob:pass@127.0.0.1:5432/ppob` |
| `PGUSER`/`PGPASSWORD`/`PGDATABASE` | ✅ | Dipakai docker compose (dan fallback bila `DATABASE_URL` kosong) |
| `BACKUP_BOT_TOKEN` | | Token bot **khusus backup** (beda dari `BOT_TOKEN`). Kosong = pakai `BOT_TOKEN` |
| `BACKUP_CHAT_ID` | | Chat/channel tujuan backup harian (offsite) |
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | | Untuk Local Bot API (my.telegram.org) |
| `BOT_API_ROOT` | | URL Local Bot API (mis. http://localhost:8081) |
| `REDIS_URL` | | URL Redis untuk cache session |
| `DIGIFLAZZ_USERNAME` / `DIGIFLAZZ_API_KEY` | ✅* | Kredensial Digiflazz |
| `TOPUP_INFO` | | Info rekening transfer manual |
| `MIN_TOPUP` | | Nominal top up minimum |
| `STORE_NAME` / `MAINTENANCE_INFO` | | Tampilan menu |
| `BOT_VPN_URL` / `ADMIN_CONTACT` | | Link tombol |

\* Tanpa kredensial Digiflazz, bot jalan tapi fitur beli & sync produk nonaktif.

## Cara Pakai Pertama Kali

1. `/start`, lalu ketik `/id` untuk ambil ID Telegram → isi ke `ADMIN_IDS`.
2. Admin → 🔄 **Sync Produk** untuk tarik harga Digiflazz.
3. (Opsional) Admin → 🏷 **Markup** untuk atur keuntungan.
4. Produk siap dijual.

## Perintah
- `/start` / `/menu` — menu utama
- `/saldo` — cek saldo
- `/id` — ID Telegram kamu

## Keamanan
- Jangan commit `.env`. Jangan bagikan `api_hash`.
- Whitelist IP server di dashboard Digiflazz.
