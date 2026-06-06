# Cho Store PPOB Bot

Bot Telegram PPOB lengkap (pulsa, paket data, token PLN, voucher game, e-money) dengan integrasi **Digiflazz**, sistem saldo & deposit, **markup fleksibel**, cache session **Redis**, dan dukungan **Telegram Local Bot API** untuk respons tombol super cepat.

## Fitur

- 🛒 **Beli Paket** (`order.js`) — kategori → brand → produk → nomor tujuan → konfirmasi → bayar.
- 💰 **Saldo / Top Up** (`deposit.js`) — buat deposit, transfer manual, approve/tolak admin.
- 📦 **Cek Stok** (`stok.js`) — lihat daftar produk + harga jual tanpa beli.
- 📜 **Riwayat** (`riwayat.js`) — 10 transaksi terakhir + SN.
- 🧰 **Tools** (`tools.js`) — cek operator dari nomor HP.
- ❓ **Bantuan** (`help.js`).
- ⚙️ **Panel Admin** (`admin.js`) — statistik, approve deposit, saldo manual, set role, **atur markup**, sync produk, broadcast.
- 🔁 Refund otomatis jika transaksi ke provider gagal.

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
├── db/database.js          # SQLite
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
# 1) Redis (cache session)
apt install redis-server -y && systemctl enable --now redis

# 2) Docker
curl -fsSL https://get.docker.com | bash

# 3) Local Bot API (ganti API_ID & API_HASH dari my.telegram.org)
docker run -d \
  --name telegram-bot-api \
  --restart always \
  -p 127.0.0.1:8081:8081 \
  -e TELEGRAM_API_ID=API_ID_KAMU \
  -e TELEGRAM_API_HASH=API_HASH_KAMU \
  -e TELEGRAM_LOCAL=1 \
  -v /root/bot-api-data:/var/lib/telegram-bot-api \
  -v /root/bot-api-temp:/tmp/telegram-bot-api \
  aiogram/telegram-bot-api:latest

# 4) Bot
git clone <repo-url> && cd ppob
npm install            # butuh build-essential & python3 untuk better-sqlite3
cp .env.example .env   # isi BOT_TOKEN, ADMIN_IDS, DIGIFLAZZ_*, dll
npm start
```

Lalu di `.env`:

```env
REDIS_URL=redis://127.0.0.1:6379
BOT_API_ROOT=http://localhost:8081
TELEGRAM_API_ID=...
TELEGRAM_API_HASH=...
```

> Jika `BOT_API_ROOT`/`REDIS_URL` dikosongkan, bot tetap jalan memakai server resmi Telegram dan session in-memory.

## Konfigurasi (.env)

| Variabel | Wajib | Keterangan |
|---|---|---|
| `BOT_TOKEN` | ✅ | Token dari @BotFather |
| `ADMIN_IDS` | ✅ | ID admin, pisah koma |
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | | Untuk Local Bot API (my.telegram.org) |
| `BOT_API_ROOT` | | URL Local Bot API (mis. http://localhost:8081) |
| `REDIS_URL` | | URL Redis untuk cache session |
| `DIGIFLAZZ_USERNAME` / `DIGIFLAZZ_API_KEY` | ✅* | Kredensial Digiflazz |
| `TOPUP_INFO` | | Info rekening transfer manual |
| `MIN_TOPUP` | | Nominal top up minimum |
| `STORE_NAME` / `MAINTENANCE_INFO` | | Tampilan menu |
| `BOT_VPN_URL` / `ADMIN_CONTACT` | | Link tombol |
| `DB_PATH` | | Lokasi SQLite |

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
