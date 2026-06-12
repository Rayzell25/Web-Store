# 🚀 Rayzell Store PPOB — Panduan Lengkap & Deploy

Bot Telegram + Web Store PPOB (Pulsa, Paket Data, Token PLN, Voucher Game, E-Money) dengan Panel Admin Web & Multi-Supplier Digiflazz DB.

---

## 📋 Daftar Isi

1. [Tutorial Deploy di VPS Fresh dari Nol (Sampai 100% Jalan)](#1-tutorial-deploy-di-vps-fresh-dari-nol-sampai-100-jalan)
   - [Langkah 1: Persiapan VPS Baru](#langkah-1-persiapan-vps-baru)
   - [Langkah 2: Clone Repository](#langkah-2-clone-repository)
   - [Langkah 3: Jalankan Installer Sistem & Bot (`install.sh`)](#langkah-3-jalankan-installer-sistem--bot-installsh)
   - [Langkah 4: Konfigurasi `.env`](#langkah-4-konfigurasi-env)
   - [Langkah 5: Setup Pointing Domain](#langkah-5-setup-pointing-domain)
   - [Langkah 6: Setup Web Storefront, Nginx & SSL (`setup-web.sh`)](#langkah-6-setup-web-storefront-nginx--ssl-setup-websh)
   - [Langkah 7: Jalankan Ulang & Cek Status](#langkah-7-jalankan-ulang--cek-status)
2. [Penjelasan Detail Konfigurasi File `.env`](#2-penjelasan-detail-konfigurasi-file-env)
3. [Cara Login & Mengatur Admin Panel](#3-cara-login--mengatur-admin-panel)
4. [Mengatur API Digiflazz (Multi-API & Markup Harga)](#4-mengatur-api-digiflazz-multi-api--markup-harga)
5. [Sistem Backup & Restore Database](#5-sistem-backup--restore-otomatis)
6. [Troubleshooting & Perintah Berguna VPS](#6-troubleshooting--perintah-berguna-vps)
7. [Struktur File Penting](#7-struktur-file-penting)
8. [Catatan Keamanan](#8-catatan-keamanan)

---

## 1. Tutorial Deploy di VPS Fresh dari Nol (Sampai 100% Jalan)

Panduan ini dirancang untuk deployment pada VPS baru (*fresh*) menggunakan Sistem Operasi **Ubuntu 20.04 / 22.04 / 24.04** atau **Debian 10 / 11 / 12**. Silakan ikuti langkah-langkah di bawah ini secara berurutan.

### Langkah 1: Persiapan VPS Baru
1. Masuk ke VPS Anda menggunakan SSH sebagai user **root**:
   ```bash
   ssh root@IP_VPS_ANDA
   ```
2. Lakukan update dan upgrade sistem paket OS untuk memastikan semuanya aman & terbaru:
   ```bash
   apt update && apt upgrade -y
   ```

### Langkah 2: Clone Repository
1. Buat folder `/var/www` untuk penempatan aplikasi, lalu masuk ke folder tersebut:
   ```bash
   mkdir -p /var/www && cd /var/www
   ```
2. Clone repository project ini dari GitHub:
   ```bash
   git clone https://github.com/Rayzell25/web-store.git Web-Store
   ```
3. Masuk ke direktori web-app (sumber utama kode program):
   ```bash
   cd Web-Store/web-app
   ```

### Langkah 3: Jalankan Installer Sistem & Bot (`install.sh`)
Script `install.sh` akan otomatis:
- Memasang paket sistem penting (curl, git, zip, p7zip, cron, openssl).
- Menginstal Docker & Docker Compose.
- Menginstal Redis.
- Menginstal Node.js 20 (LTS).
- Menjalankan PostgreSQL & Local Telegram Bot API menggunakan Docker Compose.
- Menyiapkan cron backup otomatis harian (jam 03:00) yang dikirim langsung ke chat/channel Telegram.
- Mendaftarkan Bot Telegram sebagai systemd service (`rayzell-ppob`).

1. Jalankan script installer otomatis:
   ```bash
   sudo bash install.sh
   ```
2. Saat proses instalasi berjalan, script akan meminta Anda menginput data berikut pada terminal:
   - **Token bot**: Masukkan Token Bot Telegram Anda (dibuat dari [@BotFather](https://t.me/BotFather)).
   - **ID owner**: Masukkan ID Telegram Anda (bisa didapat melalui [@userinfobot](https://t.me/userinfobot)).
   - **ID channel / grup**: Masukkan ID channel atau grup tempat backup harian database dikirimkan (contoh: `-100xxxxxxxxxx`).
3. Setelah script selesai berjalan, **simpan & catat baik-baik password database PostgreSQL dan password ZIP backup** yang digenerate otomatis di akhir proses.

### Langkah 4: Konfigurasi `.env`
Buka file konfigurasi `.env` untuk melengkapi konfigurasi web storefront, kredensial admin, API supplier, dan metode pembayaran:
```bash
nano .env
```

Sesuaikan nilai variabel berikut sesuai kebutuhan Anda:

```env
# ===== TELEGRAM BOT & OWNER =====
BOT_TOKEN=token_bot_utama_anda
ADMIN_IDS=id_telegram_anda

# ===== ADMIN WEB (Wajib diganti!) =====
WEB_ADMIN_EMAIL=admin@domainkamu.com    # Email untuk login panel admin web
WEB_ADMIN_USER=admin                    # Username admin web
WEB_ADMIN_PASSWORD=PasswordKuatAnda     # Password baru untuk login panel admin web

# ===== WEB STOREFRONT =====
WEB_PORT=3000
PUBLIC_URL=https://domainkamu.com       # Ganti dengan domain utama Anda (tanpa / di akhir)
CONTACT_WA=08xxxxxxxxxxx                # Nomor WA CS (gunakan awalan 08 / 62)
CONTACT_TG=https://t.me/username_kamu   # Link akun Telegram CS
BOT_USERNAME=username_bot_tanpa_at      # Contoh: rayzell_store_bot (tanpa tanda @)

# ===== SUPPLIER DIGIFLAZZ =====
DIGIFLAZZ_USERNAME=username_digiflazz_anda
DIGIFLAZZ_API_KEY=api_key_digiflazz_anda
DIGIFLAZZ_MODE=prepaid

# ===== PAYMENT GATEWAY / QRIS =====
AUTOGOPAY_API_KEY=key_autogopay_anda     # Kosongkan jika belum menggunakan QRIS otomatis
```
*Simpan file dengan menekan **Ctrl + X**, lalu tekan **Y**, dan tekan **Enter**.*

### Langkah 5: Setup Pointing Domain
Sebelum melanjutkan, pastikan domain Anda telah diarahkan ke **IP VPS** Anda. Masuk ke panel domain provider Anda dan tambahkan DNS Record berikut:
*   **A Record** -> `@` -> `IP_VPS_ANDA`
*   **A Record** -> `www` -> `IP_VPS_ANDA`
*(Tunggu sekitar 1–5 menit agar propagasi DNS berjalan).*

### Langkah 6: Setup Web Storefront, Nginx & SSL (`setup-web.sh`)
Script ini akan:
- Memasang Web Server Nginx & Certbot SSL.
- Menginstal dependencies Node.js web storefront.
- Membuat systemd service untuk web storefront (`rayzell-web`).
- Membuat konfigurasi Reverse Proxy Nginx untuk domain Anda.
- Menghasilkan dan mengaktifkan sertifikat SSL gratis (HTTPS) dari Let's Encrypt secara otomatis.

1. Jalankan script setup web dengan menyertakan nama domain Anda:
   ```bash
   sudo bash scripts/setup-web.sh domainkamu.com
   ```
2. Ikuti petunjuk Certbot di layar terminal untuk menyelesaikan pemasangan HTTPS (tekan setuju ToS, izinkan redirect dari HTTP ke HTTPS).

### Langkah 7: Jalankan Ulang & Cek Status
Restart seluruh service aplikasi agar perubahan `.env` yang baru saja dilakukan terbaca sempurna:
```bash
systemctl restart rayzell-ppob
systemctl restart rayzell-web
```

Cek status service untuk memastikan semuanya berjalan 100% normal:
```bash
systemctl status rayzell-ppob    # Cek status bot Telegram
systemctl status rayzell-web     # Cek status web storefront
```

Untuk memantau log secara real-time:
```bash
journalctl -u rayzell-web -f     # Pantau log web storefront
journalctl -u rayzell-ppob -f    # Pantau log bot Telegram
```

---

## 2. Penjelasan Detail Konfigurasi File `.env`

File `.env` terletak di `/var/www/Web-Store/web-app/.env`. Berikut adalah penjelasan parameter penting:

| Parameter | Penjelasan | Contoh Nilai |
|---|---|---|
| `BOT_TOKEN` | Token Bot Telegram Utama Anda dari BotFather | `123456:ABC-DEF_yourtoken` |
| `ADMIN_IDS` | ID Telegram Admin/Owner (pisahkan dengan koma jika multi) | `123456789,987654321` |
| `DATABASE_URL` | String koneksi database PostgreSQL (diatur otomatis) | `postgres://ppob:password@127.0.0.1:5432/ppob` |
| `WEB_ADMIN_EMAIL` | Alamat email untuk masuk ke panel admin | `admin@gmail.com` |
| `WEB_ADMIN_PASSWORD` | Password baru untuk masuk ke panel admin | `PasswordKuatS3kali!` |
| `PUBLIC_URL` | Alamat website storefront yang terpasang SSL | `https://rayzelldigital.web.id` |
| `BOT_USERNAME` | Username bot Telegram PPOB jualan Anda | `rayzell_store_bot` |
| `DIGIFLAZZ_USERNAME` | Username akun supplier Digiflazz Anda | `rayzelldigi` |
| `DIGIFLAZZ_API_KEY` | API Key Production dari Digiflazz | `dev-key-xxxx-xxxx` |
| `AUTOGOPAY_API_KEY` | API Key dari AutoGoPay (untuk sistem QRIS otomatis) | `agp_key_xxxx` |

---

## 3. Cara Login & Mengatur Admin Panel

Setelah instalasi selesai, buka browser Anda dan kunjungi dashboard admin:
```
https://domainkamu.com/admin/
```

1. Masukkan **Email** & **Password** yang telah diatur di `.env` (pada bagian `WEB_ADMIN_EMAIL` dan `WEB_ADMIN_PASSWORD`).
2. Klik **Masuk ke Dashboard**.
3. Di dalam admin dashboard, Anda dapat mengelola:
   - **Tampilan Toko (CMS)**: Ganti nama toko, upload logo, favicon, ganti warna tema, kelola keunggulan toko, dan informasi kontak/footer.
   - **Banner & Slide**: Atur gambar dan teks promo berjalan di beranda.
   - **Metode Pembayaran**: Aktifkan Midtrans, Duitku, atau QRIS AutoGoPay secara langsung.
   - **Manajemen User**: Tambah saldo member, ubah level ke Reseller/Admin, dan blokir member bermasalah.
   - **Status & Riwayat Transaksi**: Monitor status pembelian (Sukses, Pending, Gagal), edit status, dan export riwayat dalam file CSV.

---

## 4. Mengatur API Digiflazz (Multi-API & Markup Harga)

Aplikasi ini mendukung penggunaan **Multi-API Digiflazz** secara fleksibel:

1. Masuk ke Admin Panel → Menu **🔑 API Digiflazz**.
2. Klik **+ Tambah API**.
3. Isi label pengenal, username, API Key Digiflazz, dan pilih tipe harga (*VIP*, *Reseller*, *Basic*, atau *Custom*).
4. Klik **Aktifkan** pada API yang ingin digunakan, lalu tekan **💾 Simpan Semua API**.
5. Untuk sinkronisasi produk dari Digiflazz ke database lokal:
   - Hubungi bot Telegram Anda, jalankan `/start`.
   - Pilih menu **Admin** -> **Sinkronisasi Produk**.

---

## 5. Sistem Backup & Restore Otomatis

Database Anda diamankan secara otomatis ke Telegram menggunakan enkripsi ZIP (AES-256).

| Keterangan | Nilai / Jalur |
|---|---|
| **Folder Backup di VPS** | `/var/www/Web-Store/web-app/backups/` |
| **Format File** | `ppob-YYYYMMDD-HHMMSS.zip` |
| **Jadwal Backup Otomatis** | Setiap hari pukul **03:00 WIB** (Cron Job) |
| **Pengiriman Backup** | Dikirimkan langsung ke Telegram Chat ID (`BACKUP_CHAT_ID`) |

### Cara Backup Manual
Jika ingin membackup database secara manual sebelum melakukan pembaruan kode:
```bash
cd /var/www/Web-Store/web-app
bash scripts/backup.sh
```

### Cara Restore Database
Untuk mengembalikan data dari file ZIP backup:
```bash
cd /var/www/Web-Store/web-app

# 1. Lihat daftar file backup yang ada
ls -lh backups/

# 2. Lakukan restore (Hati-hati: Menimpa database saat ini!)
bash scripts/restore.sh backups/ppob-20260612-030000.zip

# 3. Restart aplikasi agar data dimuat ulang
systemctl restart rayzell-ppob && systemctl restart rayzell-web
```

---

## 6. Troubleshooting & Perintah Berguna VPS

### Aplikasi tidak merespon setelah edit `.env`
Pastikan Anda selalu melakukan restart service setelah memodifikasi konfigurasi `.env`:
```bash
systemctl restart rayzell-ppob
systemctl restart rayzell-web
```

### Memantau Log Error
Jika terjadi error di web storefront atau bot Telegram:
```bash
# Log Web Storefront
journalctl -u rayzell-web --no-pager -n 50

# Log Bot Telegram
journalctl -u rayzell-ppob --no-pager -n 50
```

### Memeriksa Status Docker Postgres & Local Bot API
Jika database tidak merespon:
```bash
docker compose ps
docker compose logs postgres --tail=30
```

---

## 7. Struktur File Penting

```
Web-Store/
└── web-app/
    ├── .env                   ← Konfigurasi sistem (JANGAN COMMIT KE GITHUB!)
    ├── .env.example           ← Contoh format file konfigurasi
    ├── install.sh             ← Installer sistem (Docker, Redis, PostgreSQL, Bot)
    ├── scripts/
    │   ├── setup-web.sh       ← Setup Nginx, Systemd Web, dan SSL Let's Encrypt
    │   ├── backup.sh          ← Script backup database otomatis
    │   └── restore.sh         ← Script restore database otomatis
    └── src/
        ├── main.js            ← Entrypoint program Bot Telegram
        └── web/
            ├── server.js      ← Server API & storefront web
            └── public/        ← Source code frontend storefront & admin panel
```

---

## 8. Catatan Keamanan

- ⚠️ **Jangan pernah membagikan file `.env`** atau meng-commit file `.env` ke Git / GitHub.
- 🔒 Simpan **Password ZIP Backup** di tempat yang aman dan terpisah dari server VPS.
- 🔑 Gunakan password admin yang kompleks (kombinasi huruf besar, kecil, angka, dan karakter khusus).
- 🛡️ Selalu gunakan port HTTPS (SSL) untuk mengakses halaman admin.

---
*Developed with ❤️ by Rayzell Store — [github.com/Rayzell25/web-store](https://github.com/Rayzell25/web-store)*
