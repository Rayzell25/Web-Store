# Rayzell Store PPOB — Panduan Backup & Restore

Catatan cepat cara **backup** & **restore** database bot. Simpan di sini biar kalau lupa tinggal buka GitHub.

> Semua perintah dijalankan di VPS, di dalam folder project (mis. `~/ppob`).
> Database disimpan di PostgreSQL (container Docker), bukan file biasa.

---

## Ringkasan

| Hal | Nilai |
|---|---|
| Folder backup | `~/ppob/backups/` |
| Format file | `ppob-YYYYMMDD-HHMMSS.zip` (ber-password AES-256) |
| Backup otomatis | tiap hari **jam 03:00** (cron, dipasang `install.sh`) |
| Disimpan | **14 file terbaru** (`BACKUP_KEEP`, sisanya dihapus otomatis) |
| Dikirim ke | channel/grup Telegram (`BACKUP_CHAT_ID`) |
| Password ZIP | dari `.env` → `BACKUP_ZIP_PASSWORD` (**SIMPAN baik-baik!**) |

⚠️ **Tanpa `BACKUP_ZIP_PASSWORD`, file backup tidak bisa dibuka/di-restore.** Catat password ini di tempat aman.

---

## 1. BACKUP

### Backup manual (kapan saja)
```bash
cd ~/ppob
bash scripts/backup.sh
```
Hasil:
- File `.zip` baru di `~/ppob/backups/`
- File dikirim ke channel Telegram backup (kalau `BACKUP_CHAT_ID` diisi)
- File lama dirotasi (simpan 14 terbaru)

### Backup otomatis
Sudah jalan sendiri tiap **03:00** lewat cron. Cek jadwalnya:
```bash
crontab -l | grep backup
```
Cek log backup terakhir:
```bash
cat ~/ppob/backup.log | tail -20
```
Baris `[backup] terkirim ke Telegram.` = sukses terkirim (HTTP 200).

---

## 2. RESTORE (memulihkan database)

> ⚠️ **PERINGATAN: restore MENIMPA data yang ada sekarang.** Pastikan file backup-nya benar. Disarankan backup dulu sebelum restore (`bash scripts/backup.sh`).

### Langkah restore
```bash
cd ~/ppob

# 1. lihat daftar file backup yang ada
ls -lh backups/

# 2. restore dari file pilihan
bash scripts/restore.sh backups/ppob-20260607-030000.zip

# 3. WAJIB restart bot setelah restore
systemctl restart rayzell-ppob
systemctl restart rayzell-web
```
Script otomatis: ekstrak `.zip` (pakai `BACKUP_ZIP_PASSWORD` dari `.env`) → ambil file `.sql` → masukkan ke PostgreSQL.

### Restore dari file yang ada di Telegram / komputer
Kalau file backup-nya cuma ada di Telegram atau di komputer (tidak ada di VPS):
1. Download file `.zip`-nya.
2. Upload ke VPS lewat **SFTP** (FileZilla / WinSCP / `scp`) ke folder `~/ppob/backups/`.
   ```bash
   # contoh pakai scp dari komputer:
   scp ppob-20260607-030000.zip root@IP_VPS:/root/ppob/backups/
   ```
3. Jalankan restore seperti di atas:
   ```bash
   cd ~/ppob
   bash scripts/restore.sh backups/ppob-20260607-030000.zip
   systemctl restart rayzell-ppob && systemctl restart rayzell-web
   ```

> SFTP hanya untuk **memindahkan file**. Proses restore tetap pakai `scripts/restore.sh`.

---

## 3. Pengaturan terkait (di `.env`)

| Variabel | Fungsi | Default |
|---|---|---|
| `BACKUP_ZIP_PASSWORD` | Password buka file ZIP backup (AES-256) | digenerate `install.sh` |
| `BACKUP_CHAT_ID` | ID channel/grup Telegram tujuan backup | (kosong = tidak kirim) |
| `BACKUP_BOT_TOKEN` | Token bot khusus backup (opsional) | fallback ke `BOT_TOKEN` |
| `BACKUP_KEEP` | Jumlah file backup disimpan | `14` |
| `PGUSER` / `PGDATABASE` | User & nama database | `ppob` / `ppob` |
| `PG_CONTAINER` | Nama container PostgreSQL | `ppob-postgres` |

---

## 4. Troubleshooting

| Gejala | Penyebab | Solusi |
|---|---|---|
| `restore.sh` minta password / gagal ekstrak | `BACKUP_ZIP_PASSWORD` di `.env` beda dengan saat backup dibuat | pakai password yang sama dengan saat file itu dibuat |
| Backup otomatis tidak jalan | cron mati | `systemctl enable --now cron` lalu cek `crontab -l` |
| Backup tidak terkirim ke Telegram | `BACKUP_CHAT_ID` kosong / bot belum admin channel | isi `BACKUP_CHAT_ID`, jadikan bot admin di channel |
| `the input device is not a TTY` di log | (sudah diperbaiki) dump pakai `docker exec` tanpa `-t` | pastikan kode terbaru (`git pull`) |
| Setelah restore data belum berubah | bot belum di-restart | `systemctl restart rayzell-ppob` |

---

## Catatan keamanan
- **Jangan** commit file `.env` ke Git (sudah di-`.gitignore`).
- Simpan `BACKUP_ZIP_PASSWORD` di tempat aman — tanpa itu backup tidak berguna.
- Jangan tempel token bot / token GitHub ke chat atau tempat publik.

---
*Dokumentasi lain: lihat `docs/PREMIUM_EMOJI.md` untuk panduan custom/premium emoji.*
