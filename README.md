# Cho Store PPOB Bot

Bot Telegram PPOB lengkap (pulsa, paket data, token PLN, voucher game, e-money) dengan integrasi **Digiflazz**, sistem saldo, top up dengan konfirmasi admin, riwayat transaksi, tools, dan panel admin.

## Fitur

- 🛒 **Beli Paket** — kategori → brand/operator → produk → input nomor → konfirmasi → bayar pakai saldo.
- 💰 **Saldo / Top Up** — buat permintaan top up, transfer manual, disetujui/ditolak admin.
- 📜 **Riwayat** — 10 transaksi terakhir lengkap dengan status & SN.
- 🧰 **Tools** — cek operator berdasarkan nomor HP.
- ❓ **Bantuan** — panduan pemakaian.
- ⚙️ **Panel Admin** — statistik, approve top up, tambah saldo manual, set role, sync produk Digiflazz, broadcast.
- 🔁 Refund otomatis kalau transaksi ke provider gagal.
- 🎖 Harga jual otomatis = harga modal Digiflazz + markup (beda untuk MEMBER & RESELLER).

## Persiapan

1. **Node.js 18+** terpasang.
2. Akun **Digiflazz** (https://digiflazz.com) → ambil `username` dan `API Key` (Development/Production) di menu API. Whitelist IP server kamu di Digiflazz.
3. Token bot dari **@BotFather**.
4. ID Telegram kamu (cek lewat **@userinfobot** atau ketik `/id` ke bot ini setelah jalan).

## Instalasi

```bash
git clone <repo-url>
cd ppob
npm install
cp .env.example .env
# edit .env, isi BOT_TOKEN, ADMIN_IDS, DIGIFLAZZ_USERNAME, DIGIFLAZZ_API_KEY, dll
npm start
```

> `better-sqlite3` butuh build native. Jika gagal di server, install build tools:
> Ubuntu/Debian: `sudo apt install -y build-essential python3`

## Konfigurasi (.env)

| Variabel | Wajib | Keterangan |
|---|---|---|
| `BOT_TOKEN` | ✅ | Token dari @BotFather |
| `ADMIN_IDS` | ✅ | ID admin, pisah koma untuk banyak admin |
| `DIGIFLAZZ_USERNAME` | ✅* | Username Digiflazz |
| `DIGIFLAZZ_API_KEY` | ✅* | API Key Digiflazz |
| `MARKUP_DEFAULT` | | Markup rupiah untuk MEMBER (default 500) |
| `MARKUP_RESELLER` | | Markup rupiah untuk RESELLER (default 250) |
| `TOPUP_INFO` | | Info rekening tujuan transfer manual |
| `MIN_TOPUP` | | Nominal top up minimum (default 10000) |
| `STORE_NAME` | | Nama toko di menu |
| `MAINTENANCE_INFO` | | Jam maintenance yang ditampilkan |
| `BOT_VPN_URL` | | Link tombol BOT VPN (opsional) |
| `ADMIN_CONTACT` | | Link kontak admin untuk non-admin |
| `DB_PATH` | | Lokasi file SQLite (default data/ppob.db) |

\* Tanpa kredensial Digiflazz, bot tetap jalan tapi fitur beli & sync produk tidak berfungsi.

## Cara Pakai Pertama Kali

1. Jalankan bot, kirim `/start`.
2. Sebagai admin, buka **⚙️ ADMIN → 🔄 Sync Produk** untuk menarik daftar harga Digiflazz.
3. Produk siap dibeli lewat **🛒 Beli Paket**.
4. Top up saldo user disetujui lewat **⚙️ ADMIN → 🧾 Top Up Pending**.

## Perintah

- `/start` atau `/menu` — buka menu utama
- `/saldo` — cek saldo
- `/id` — lihat ID Telegram kamu

## Struktur Proyek

```
src/
├── index.js              # entry point: routing pesan & callback
├── config.js             # konfigurasi dari .env
├── db/database.js        # SQLite (better-sqlite3)
├── services/
│   ├── digiflazz.js      # client API Digiflazz
│   ├── userService.js    # user & saldo
│   ├── trxService.js     # transaksi
│   ├── topupService.js   # top up
│   └── productService.js # produk & harga
├── handlers/
│   ├── start.js          # menu utama
│   ├── beliPaket.js      # alur pembelian
│   ├── topup.js          # alur top up
│   ├── misc.js           # riwayat, tools, bantuan
│   └── admin.js          # panel admin
├── keyboards/menus.js    # keyboard inline
└── utils/                # logger, format, session, registry
```

## Catatan Keamanan

- Jangan commit `.env` (sudah di `.gitignore`).
- Gunakan API Key **Production** Digiflazz hanya saat siap live; gunakan Development key untuk uji coba.
- Whitelist IP server di dashboard Digiflazz agar transaksi tidak ditolak.
