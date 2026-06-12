# 🚀 Rayzell Store PPOB — Panduan Lengkap

Bot Telegram + Web Store PPOB (Pulsa, Data, PLN, dll) dengan panel admin web.

---

## 📋 Daftar Isi

1. [Instalasi di VPS](#1-instalasi-di-vps)
2. [Konfigurasi File .env](#2-konfigurasi-file-env)
3. [Cara Login Admin Panel](#3-cara-login-admin-panel)
4. [Cara Atur Email & Password Admin](#4-cara-atur-email--password-admin)
5. [Fitur Admin Panel](#5-fitur-admin-panel)
6. [API Digiflazz (VIP / Reseller)](#6-api-digiflazz-vip--reseller)
7. [Backup & Restore Database](#7-backup--restore-database)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Instalasi di VPS

```bash
# Clone repository
git clone https://github.com/Rayzell25/web-store.git
cd web-store

# Copy file konfigurasi
cp .env.example .env

# Edit konfigurasi (lihat bagian 2)
nano .env

# Jalankan instalasi otomatis
bash install.sh
```

---

## 2. Konfigurasi File .env

Buka file `.env` dengan nano:

```bash
nano /root/web-store/.env
```

### Variabel Penting yang WAJIB Diisi:

```env
# ===== TELEGRAM BOT =====
BOT_TOKEN=123456:ABC-DEF_tokenbot_dari_botfather
ADMIN_IDS=123456789                    # ID Telegram kamu (cek lewat @userinfobot)

# ===== DIGIFLAZZ =====
DIGIFLAZZ_USERNAME=username_digiflazz
DIGIFLAZZ_API_KEY=api_key_digiflazz
DIGIFLAZZ_MODE=prepaid                 # prepaid atau pasca

# ===== DATABASE =====
DATABASE_URL=postgres://ppob:PASSWORD@127.0.0.1:5432/ppob

# ===== WEB STOREFRONT =====
WEB_PORT=3000
PUBLIC_URL=https://domain-kamu.com
CONTACT_WA=628xxxxxxxxxx
CONTACT_TG=https://t.me/username_kamu

# ===== ADMIN PANEL LOGIN =====        ← INI YANG PALING PENTING
WEB_ADMIN_EMAIL=admin@gmail.com        # Email untuk login /admin
WEB_ADMIN_PASSWORD=passwordkuat123    # Password untuk login /admin

# ===== QRIS (opsional) =====
AUTOGOPAY_API_KEY=api_key_autogopay

# ===== GOOGLE LOGIN (opsional) =====
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REDIRECT_URI=https://domain-kamu.com/api/auth/google/callback
```

### Simpan File:
- Tekan **Ctrl + X**
- Tekan **Y**
- Tekan **Enter**

---

## 3. Cara Login Admin Panel

1. Buka browser, akses: `https://domain-kamu.com/admin/`
2. Masukkan **email** dan **password** yang sudah diatur di `.env`
3. Klik **Masuk ke Dashboard**

> Jika belum mengatur email & password, lihat bagian 4 di bawah.

---

## 4. Cara Atur Email & Password Admin

### Langkah-langkah di VPS:

```bash
# 1. Buka file .env
nano /root/web-store/.env
```

Cari atau tambahkan baris ini (biasanya di bagian paling bawah):

```env
# ===== ADMIN PANEL LOGIN =====
WEB_ADMIN_EMAIL=admin@gmail.com
WEB_ADMIN_PASSWORD=passwordkuat123
```

> ✏️ Ganti `admin@gmail.com` dan `passwordkuat123` sesuai keinginan kamu.

```bash
# 2. Simpan file (Ctrl+X → Y → Enter)

# 3. Restart server agar perubahan berlaku
pm2 restart all

# atau jika pakai systemctl:
systemctl restart rayzell-web

# atau jika pakai Docker:
docker-compose restart
```

### Tips Password Aman:
- Minimal **8 karakter**
- Kombinasi huruf besar, kecil, angka, simbol
- Contoh: `R@yZ3ll#2025!`

### Cek Status Server:
```bash
pm2 status          # lihat semua proses
pm2 logs            # lihat log terbaru
```

---

## 5. Fitur Admin Panel

Akses di: `https://domain-kamu.com/admin/dashboard.html`

| Menu | Fungsi |
|------|--------|
| 📊 **Dashboard** | Statistik pengguna, transaksi, omzet, saldo Digiflazz |
| 💳 **Transaksi** | Riwayat semua transaksi |
| 💰 **Top Up Pending** | Konfirmasi / tolak top up saldo manual |
| 👥 **Pengguna** | Daftar semua member terdaftar |
| 🎠 **Slide Beranda** | Edit slide/carousel di halaman utama |
| 🖊️ **Edit Teks Web** | Ubah hero, tagline, kontak, footer, warna tema |
| 🖼️ **Upload / Hapus Ikon** | Upload foto produk, logo brand, ikon custom |
| 🏷️ **Logo Brand** | Upload/hapus logo brand di halaman beranda |
| 🔑 **API Digiflazz** | Kelola multi API (VIP, Reseller, Basic, Custom) |
| ⚙️ **Pengaturan Toko** | Nama toko, WA, Telegram, ubah password admin |

---

## 6. API Digiflazz (VIP / Reseller)

Panel admin mendukung **lebih dari 1 API Digiflazz** sekaligus.

### Cara Tambah API:
1. Buka Admin Panel → menu **🔑 API Digiflazz**
2. Klik tombol **+ Tambah API**
3. Isi:
   - **Label** — nama pengenal API (contoh: "API VIP Utama")
   - **Username** — username akun Digiflazz kamu
   - **API Key** — dari dashboard Digiflazz
   - **Tipe Harga** — pilih salah satu:
     - ⭐ **VIP** — harga VIP, volume tinggi
     - 🔄 **Reseller** — harga reseller, margin lebih
     - 🔹 **Basic** — mode standar
     - ⚙️ **Custom** — konfigurasi manual
   - **Mode** — Prepaid / Pasca / Semua
4. Klik **Aktifkan** untuk API yang akan dipakai
5. Klik **💾 Simpan Semua API**

### Cara Dapat API Key Digiflazz:
1. Login ke [digiflazz.com](https://digiflazz.com)
2. Menu **Pengaturan** → **API**
3. Copy **Username** dan **API Key** (Production)

### Setting di `.env` (untuk API utama):
```env
DIGIFLAZZ_USERNAME=username_kamu
DIGIFLAZZ_API_KEY=api_key_kamu
DIGIFLAZZ_MODE=prepaid
```

---

## 7. Backup & Restore Database

### Ringkasan

| Hal | Nilai |
|-----|-------|
| Folder backup | `~/web-store/backups/` |
| Format file | `ppob-YYYYMMDD-HHMMSS.zip` (AES-256) |
| Backup otomatis | Tiap hari **jam 03:00** (cron) |
| Disimpan | **14 file terbaru** |
| Dikirim ke | Channel/grup Telegram (`BACKUP_CHAT_ID`) |
| Password ZIP | Dari `.env` → `BACKUP_ZIP_PASSWORD` |

> ⚠️ **Simpan `BACKUP_ZIP_PASSWORD` di tempat aman!** Tanpa ini, backup tidak bisa dibuka.

### Backup Manual:
```bash
cd ~/web-store
bash scripts/backup.sh
```

### Restore Database:
```bash
cd ~/web-store

# Lihat daftar backup
ls -lh backups/

# Restore (HATI-HATI: menimpa data yang ada!)
bash scripts/restore.sh backups/ppob-20260607-030000.zip

# Restart setelah restore
pm2 restart all
```

### Upload Backup dari Komputer ke VPS:
```bash
scp ppob-backup.zip root@IP_VPS:/root/web-store/backups/
```

### Variabel Backup di `.env`:
```env
BACKUP_ZIP_PASSWORD=password_zip_backup    # WAJIB disimpan!
BACKUP_CHAT_ID=-1001234567890              # ID channel Telegram
BACKUP_BOT_TOKEN=token_bot_backup          # opsional
BACKUP_KEEP=14                             # jumlah file disimpan
```

---

## 8. Troubleshooting

### Login Admin Tidak Bisa Masuk
```bash
# Cek apakah variabel sudah ada di .env
grep "WEB_ADMIN" /root/web-store/.env

# Pastikan sudah restart server setelah edit .env
pm2 restart all
```

### Server Tidak Jalan
```bash
pm2 status          # cek status
pm2 logs --lines 50 # lihat error log
```

### Restore Gagal / Minta Password
- Pastikan `BACKUP_ZIP_PASSWORD` di `.env` sama persis dengan saat backup dibuat

### Backup Tidak Terkirim ke Telegram
- Pastikan `BACKUP_CHAT_ID` sudah diisi
- Bot harus sudah jadi admin di channel tujuan

### Cek Log Backup:
```bash
cat ~/web-store/backup.log | tail -20
```

---

## 📁 Struktur File Penting

```
web-store/
├── .env                    ← Konfigurasi (JANGAN di-commit!)
├── .env.example            ← Contoh konfigurasi
├── src/
│   └── web/
│       └── public/
│           └── admin/
│               ├── index.html       ← Halaman login admin
│               └── dashboard.html   ← Dashboard admin
├── scripts/
│   ├── backup.sh
│   └── restore.sh
└── install.sh
```

---

## 🔒 Catatan Keamanan

- ❌ **Jangan** commit file `.env` ke Git (sudah ada di `.gitignore`)
- ✅ Simpan `BACKUP_ZIP_PASSWORD` di tempat aman
- ✅ Gunakan password admin yang kuat (min. 12 karakter)
- ✅ Jangan bagikan token bot / API key ke siapapun

---

*Dibuat dengan ❤️ oleh Rayzell Store — [github.com/Rayzell25/web-store](https://github.com/Rayzell25/web-store)*
