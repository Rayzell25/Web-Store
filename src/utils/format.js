'use strict';

/** Garis pemisah tipis (tema minimalis, konsisten di semua layar) */
const LINE = '─────────────────────';

/** Format angka jadi rupiah: 306100 -> "Rp 306.100" */
function rupiah(value) {
  const n = Math.round(Number(value) || 0);
  return 'Rp ' + n.toLocaleString('id-ID');
}

/** Escape karakter untuk parse_mode HTML Telegram */
function escapeHtml(text) {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Tanggal lokal Indonesia */
function tanggal(date = new Date()) {
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(date instanceof Date ? date : new Date(date));
}

/** Buat kode unik transaksi: TRX + timestamp + random */
function trxCode(prefix = 'TRX') {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}${t}${r}`;
}

/** Potong teks panjang agar muat di tombol/baris */
function truncate(text, max = 30) {
  const s = String(text || '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

module.exports = { LINE, rupiah, escapeHtml, tanggal, trxCode, truncate };
