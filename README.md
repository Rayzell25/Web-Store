# Rayzell Store PPOB Bot

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
- 💳 **Pembayaran QRIS (AutoGoPay)**: beli produk & top up bisa bayar via QRIS — pembayaran terdeteksi otomatis (polling), QR & notif sukses auto-hapus, fee QRIS dibebankan ke member (bisa diatur).

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

## Pembayaran QRIS (AutoGoPay)

- Saat **beli produk**, member pilih metode: **QRIS** atau **SALDO**.
- Saat **top up saldo**, member pilih: **QRIS** (otomatis) atau **Transfer Manual** (approve admin).
- Alur QRIS: bot generate QR → member scan & bayar → poller cek status tiap beberapa detik → begitu lunas, pesanan/saldo diproses otomatis → QR & notif sukses terhapus sendiri setelah `QRIS_SUCCESS_TTL_SEC` detik.
- **Fee QRIS ditanggung member** (`QRIS_FEE_TYPE`/`QRIS_FEE_VALUE`), agar untung markup tidak terpotong fee gateway.
- Kalau QRIS sudah lunas tapi produk **gagal** di provider, harga produk otomatis **dikreditkan ke SALDO** member (tidak hangus) + admin diberi tahu.
- Set `AUTOGOPAY_API_KEY` kosong untuk mematikan QRIS (fallback: SALDO / Transfer Manual).

> QRIS pakai **polling**, jadi tidak perlu webhook/domain/buka port.

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

## Setup VPS (1 perintah)

VPS **fresh** (Ubuntu 20/22/24 atau Debian 10/11/12). `install.sh` mengurus semuanya:
apt update/upgrade, Docker, Redis, Node.js, PostgreSQL + Local Bot API (docker compose),
generate password DB & ZIP backup otomatis, pasang cron backup harian, daftarkan service systemd.

```bash
git clone <repo-url> && cd ppob
sudo bash install.sh
```

Di akhir, installer cuma menanyakan **4 hal**:

```
Token bot          :
ID owner           :
Token bot backup   :
ID channel / grup  :
```

Selesai — bot langsung jalan sebagai service. Cek:

```bash
systemctl status rayzell-ppob      # status bot
journalctl -u rayzell-ppob -f      # log realtime
docker compose ps                  # postgres + telegram-bot-api
```

> `DIGIFLAZZ_*` & `AUTOGOPAY_API_KEY` sengaja dikosongkan. Isi nanti di `.env` lalu `systemctl restart rayzell-ppob`.
> Password DB & password ZIP backup di-generate otomatis & ditampilkan sekali di akhir install — **simpan baik-baik**.

### Manual (kalau tidak pakai install.sh)

```bash
cp .env.example .env && nano .env   # isi BOT_TOKEN, ADMIN_IDS, dll
docker compose up -d                # postgres + local bot api
npm install && npm start
```

## 🛡 Backup otomatis (PENTING — biar saldo/riwayat tidak hilang)

`install.sh` sudah memasang cron harian (03:00). Backup = **`.zip` ber-password (AES-256)** berisi seluruh database (saldo member, transaksi, deposit, dll), dikirim ke **bot backup → channel/grup** (offsite). Walau VPS hilang, data aman.

```bash
bash scripts/backup.sh             # tes manual
```

Pulihkan dari backup (menimpa data sekarang):

```bash
bash scripts/restore.sh backups/ppob-YYYYMMDD-HHMMSS.zip
```

> File `.zip` butuh `BACKUP_ZIP_PASSWORD` untuk dibuka (otomatis dipakai `restore.sh`). Buka manual pakai 7-Zip/WinRAR + password tsb.

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
| `AUTOGOPAY_API_KEY` | | API Key AutoGoPay (kosong = QRIS mati) |
| `QRIS_FEE_TYPE` / `QRIS_FEE_VALUE` | | Fee QRIS ke member (flat/percent) |
| `QRIS_FEE_ROUND` / `QRIS_POLL_INTERVAL_SEC` / `QRIS_SUCCESS_TTL_SEC` | | Pembulatan, interval poll, durasi notif sebelum auto-hapus |
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
