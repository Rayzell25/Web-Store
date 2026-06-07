# Rayzell Store PPOB

Bot Telegram PPOB + Web Storefront — pulsa, paket data, token PLN, voucher game, e-money. Terhubung ke Digiflazz, pembayaran QRIS via AutoGoPay, database PostgreSQL, backup harian otomatis.

---

## Fitur

**Bot Telegram:**
- Beli produk (pulsa, data, PLN, game, e-money) — pilih kategori → brand → produk → bayar SALDO atau QRIS
- Top Up saldo via QRIS otomatis
- Riwayat transaksi
- Cek operator & cek area (Tools)
- Foto banner di /start (dapat diganti admin)
- Tombol "Buka Web" → buka web langsung dari bot
- Panel admin via /admin: statistik, approve top up, saldo manual, set role, markup, sync produk Digiflazz, broadcast, set foto

**Web (rayzelldigital.web.id/app.html):**
- Login dengan Telegram (widget di browser / auto-login saat dibuka sebagai Mini App dari bot)
- Beli produk langsung di web (bayar SALDO atau QRIS)
- Top Up saldo via QRIS
- Riwayat transaksi + top up
- Panel admin web (/admin/): statistik, transaksi terbaru, approve top up

---

## Instalasi VPS Baru (Fresh)

**Support OS:** Ubuntu 20.04 / 22.04 / 24.04, Debian 10 / 11 / 12

```bash
# 1. Clone repo (ganti TOKEN dengan Personal Access Token GitHub kamu)
git clone https://TOKEN@github.com/Rayzell25/ppob.git
cd ppob

# 2. Jalankan installer (otomatis install Docker, Redis, Node, PostgreSQL, Local Bot API, cron backup, systemd)
bash install.sh
```

Installer akan menanyakan **3 hal**:
```
Token bot          :  ← token dari @BotFather
ID owner           :  ← ID Telegram kamu (cek dengan /id setelah bot jalan)
ID channel / grup  :  ← tujuan backup harian (ID channel/grup, atau ID kamu sendiri)
```

Setelah selesai, isi credentials lain di `.env`:
```bash
nano .env
```

| Variabel | Keterangan |
|---|---|
| `DIGIFLAZZ_USERNAME` | Username Digiflazz |
| `DIGIFLAZZ_API_KEY` | API Key Digiflazz (Production) |
| `AUTOGOPAY_API_KEY` | API Key AutoGoPay (QRIS) |
| `BOT_USERNAME` | Username bot tanpa @ (untuk login web & tombol Buka Web) |
| `WEB_ADMIN_USER` | Username login panel admin web (default: admin) |
| `WEB_ADMIN_PASSWORD` | Password login panel admin web (wajib diganti!) |
| `STORE_NAME` | Nama toko di menu bot |
| `MAINTENANCE_INFO` | Jam maintenance yang ditampilkan |

Setelah isi `.env`:
```bash
systemctl restart rayzell-ppob
systemctl restart rayzell-web
```

---

## Update Bot (setelah ada perubahan kode)

```bash
cd ~/ppob
git pull
systemctl restart rayzell-ppob
systemctl restart rayzell-web
```

---

## Setup Web + SSL (setelah domain di-pointing ke IP VPS)

**1. Pointing domain** di panel DNS (Cloudflare / registrar):
```
Type: A    Name: @    Value: <IP VPS>    Proxy: DNS Only (grey cloud)
```

Cek IP VPS:
```bash
curl -s ifconfig.me
```

**2. Jalankan setup web** (setelah DNS sudah pointing):
```bash
sudo bash scripts/setup-web.sh rayzelldigital.web.id
```
Script ini otomatis: install Nginx, pasang reverse proxy, ambil SSL (Let's Encrypt), daftarkan service `rayzell-web`.

**3. Set domain di @BotFather** (untuk Login Telegram di web browser):
```
/setdomain → pilih bot → rayzelldigital.web.id
```

**4. Set Mini App di @BotFather** (untuk buka web di dalam Telegram):
```
Bot Settings → Configure Mini App → URL: https://rayzelldigital.web.id/app.html
```

**5. Set BOT_USERNAME di .env** (agar tombol Buka Web di bot mengarah ke bot yang benar):
```bash
nano .env   # BOT_USERNAME=namabot_kamu  (tanpa @)
systemctl restart rayzell-ppob && systemctl restart rayzell-web
```

---

## Perintah Berguna

```bash
# Status service
systemctl status rayzell-ppob      # bot Telegram
systemctl status rayzell-web       # web storefront

# Log realtime
journalctl -u rayzell-ppob -f      # log bot
journalctl -u rayzell-web -f       # log web

# Docker (PostgreSQL + Local Bot API)
docker compose ps
docker compose logs postgres

# Restart
systemctl restart rayzell-ppob
systemctl restart rayzell-web
```

---

## Backup & Restore

**Backup otomatis** jalan tiap hari jam 03:00 (dipasang otomatis oleh install.sh). File backup `.zip` ber-password AES-256 dikirim ke channel/grup yang diisi saat install. Backup juga tersimpan di `~/ppob/backups/` (14 file terbaru).

**Tes backup manual:**
```bash
cd ~/ppob && bash scripts/backup.sh
```

**Restore dari backup:**
```bash
bash scripts/restore.sh backups/ppob-YYYYMMDD-HHMMSS.zip
```
> Password ZIP tersimpan di `.env` sebagai `BACKUP_ZIP_PASSWORD` (ditampilkan sekali saat install — simpan baik-baik!).

---

## Setup Pertama Kali (setelah install)

1. Buka bot → `/start` → ketik `/id` untuk cek ID Telegram kamu → isi ke `ADMIN_IDS` di `.env`
2. `/admin` → **Sync Produk** → tarik daftar harga dari Digiflazz
3. `/admin` → **Markup** → atur keuntungan per transaksi
4. `/admin` → **Set Foto Sambutan** → kirim foto banner untuk tampil di /start (opsional)
5. Top up deposit di dashboard Digiflazz (modal untuk transaksi provider)
6. Whitelist IP VPS di dashboard Digiflazz (Pengaturan → Atur API → Whitelist IP → isi hasil `curl -s ifconfig.me`)

---

## Markup / Keuntungan

Atur dari bot: `/admin` → **Markup** → ketik perintah dengan pemisah `|`:

| Perintah | Keterangan |
|---|---|
| `default\|flat\|500` | Markup default MEMBER: Rp 500/trx |
| `default\|percent\|3` | Markup default: 3% dari modal |
| `reseller\|flat\|250` | Markup RESELLER: Rp 250/trx |
| `cat\|Pulsa\|flat\|1000` | Markup kategori Pulsa: Rp 1.000 |
| `sku\|xld10\|flat\|800` | Markup produk spesifik |
| `round\|100` | Pembulatan ke kelipatan Rp 100 |
| `delcat\|Pulsa` | Hapus markup kategori |

---

## Struktur Proyek

```
src/
├── main.js                  # entry point + router semua callback
├── config.js                # baca .env (tidak ada rahasia di sini)
├── cache/redis.js           # session cache Redis (fallback in-memory)
├── db/database.js           # PostgreSQL (pg Pool)
├── services/
│   ├── digiflazz.js         # API Digiflazz
│   ├── autogopay.js         # API AutoGoPay (QRIS)
│   ├── qrisPoller.js        # polling status QRIS otomatis
│   ├── qrisService.js       # tracking transaksi QRIS di DB
│   ├── userService.js       # user & saldo
│   ├── trxService.js        # transaksi
│   ├── depositService.js    # top up
│   ├── productService.js    # produk
│   └── markupService.js     # markup fleksibel (cache in-memory)
├── handlers/                # 1 domain = 1 file
│   ├── start.js  order.js  deposit.js  stok.js
│   ├── riwayat.js  tools.js  help.js  admin.js
├── keyboards/menus.js
├── utils/                   # logger, format, session, registry
└── web/
    ├── server.js            # Express web + API member + API admin
    └── public/
        ├── index.html       # landing page
        ├── app.html         # halaman belanja member (Mini App)
        └── admin/           # panel admin web
```

> Data sensitif (token, API key, password) **hanya di `.env`** yang gitignored. `config.js` hanya membaca `process.env`.

---

## Catatan Keamanan

- Jangan commit `.env` ke GitHub
- Whitelist IP VPS di dashboard Digiflazz sebelum live
- Ganti `WEB_ADMIN_PASSWORD` dari default `admin123`
- Gunakan API Key **Production** Digiflazz saat siap live (bukan Development)
