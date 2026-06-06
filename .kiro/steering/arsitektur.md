# Arsitektur Bot PPOB (Rayzell25/ppob)

Konvensi wajib untuk repo ini.

## Stack
- Node.js + `node-telegram-bot-api` (polling).
- **PostgreSQL** via `pg` (async). Akses lewat helper di `db/database.js`: `one()`, `all()`, `query()`, `withTx()`. BIGINT di-parse jadi Number JS.
- Redis (opsional) untuk cache session — `REDIS_URL`.
- Telegram **Local Bot API** (opsional) untuk latency rendah — `BOT_API_ROOT` diteruskan sebagai `baseApiUrl` ke constructor `TelegramBot`.
- **QRIS via AutoGoPay** (`services/autogopay.js`): bayar produk & top up via QRIS. Pembayaran dideteksi **polling** (`services/qrisPoller.js`), bukan webhook. State tersimpan di tabel `qris_payments`. Fee QRIS dibebankan ke member (`QRIS_FEE_*`). QR & notif sukses auto-hapus setelah `QRIS_SUCCESS_TTL_SEC`. Order QRIS yang lunas tapi produknya gagal → harga dikreditkan ke SALDO member.

## Database & keamanan data
- Semua service async (await). Mutasi saldo pakai transaksi + `SELECT ... FOR UPDATE` (atomik, anti-balapan).
- Postgres jalan via Docker (`docker-compose.yml`), dengar hanya di `127.0.0.1` (tidak terbuka ke internet). Data persisten di volume `ppob_pgdata`.
- **Backup harian wajib**: `scripts/backup.sh` (cron) -> `pg_dump` -> kirim ke Telegram via **bot khusus backup** (`BACKUP_BOT_TOKEN`, fallback `BOT_TOKEN`) ke `BACKUP_CHAT_ID` sebagai salinan offsite. Restore: `scripts/restore.sh`.
- `markupService` punya cache in-memory (load saat startup) supaya `sellPrice()` tetap sinkron di dalam loop produk.

## Aturan kode
- **Entry/router** ada di `src/main.js` (BUKAN index.js). Semua routing pesan & callback dipusatkan di sini.
- **Setiap fitur = satu file handler** di `src/handlers/` dinamai per domain:
  `start.js`, `order.js` (beli paket), `deposit.js` (top up), `stok.js`, `riwayat.js`, `tools.js`, `help.js`, `admin.js`.
- **Data sensitif HANYA di `.env`** (token, API key, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`). `config.js` hanya membaca `process.env` via dotenv — tidak boleh ada literal rahasia di file mana pun yang ter-commit.
- `.env` masuk `.gitignore`. `.env.example` memakai placeholder.

## Logika bisnis
- Margin/untung = **markup** (lihat `services/markupService.js`).
- Prioritas markup: override per-produk > markup per-kategori > default role (RESELLER punya default sendiri).
- Tipe markup: `flat` (rupiah) atau `percent` (% dari harga modal). Ada pembulatan (`round`).
- Markup bisa diatur admin dari bot (menu Admin → Markup), format pakai pemisah `|`.
- Transaksi dipotong saldo di depan; jika provider gagal → **refund otomatis**.

## Session
- `utils/session.js` async: Redis bila tersedia, fallback Map in-memory. Semua pemanggil harus `await`.

## Callback naming
- Menu: `menu:home|order|deposit|stok|riwayat|tools|bantuan|admin`
- Order: `order:cat:<tok>`, `order:brand:<tok>:<tok>`, `order:prod:<sku>`, `order:pay:saldo`, `order:pay:qris`
- Stok: `stok:cat:<tok>`, `stok:brand:<tok>:<tok>`
- Deposit: `deposit:new`, `deposit:qris`, `deposit:manual`, `dp:ok:<id>`, `dp:no:<id>`
- QRIS: `qris:check:<txId>`, `qris:cancel:<txId>`
- Admin: `adm:stats|deposits|addsaldo|setrole|markup|sync|broadcast`
- `callback_data` dibatasi 64 byte → nilai panjang (kategori/brand) dipetakan ke token pendek via `utils/registry.js`.
