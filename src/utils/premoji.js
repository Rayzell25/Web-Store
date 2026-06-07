'use strict';

/**
 * Premium / custom emoji Telegram.
 *
 * CATATAN PENTING:
 *  - Premium emoji HANYA bisa render di TEKS pesan / caption (parse_mode HTML),
 *    TIDAK bisa di label tombol inline (tombol = plain text).
 *  - Bot hanya boleh mengirim custom emoji bila bot punya username Fragment.
 *    Kalau belum eligible, Telegram menolak entity-nya -> kita strip & kirim
 *    fallback unicode-nya supaya menu tetap tampil (tidak error/blank).
 *
 * ID di bawah ini diisi oleh owner (sudah di-generate, bukan asal).
 * Tiap entri: [emoji-id, fallback-unicode].
 */
const EMOJI = {
  halo:       ['5816508088227730739', '👋'],
  saldo:      ['5971895400792067820', '💳'],
  role:       ['5971895400792067820', '👤'],
  statistik:  ['5884161133174067365', '📊'],
  transaksi:  ['5972124077735807885', '🧾'],
  hariini:    ['5972124077735807885', '📅'],
  pengguna:   ['5972124077735807885', '👥'],
  maintenance:['5933544413740403607', '🛠️'],
  beli:    ['5864095106096698177', '🛒'],
  topup:   ['5282843764451195532', '💰'],
  riwayat: ['5215209935188534658', '🧾'],
  harga:   ['5231012545799666522', '🏷️'],
  tools:   ['4920401966946845302', '🛠️'],
  bantuan: ['5215538577496090960', '💬'],
  web:     ['5375346433610235523', '🌐'],
};

/** Render satu premium emoji jadi tag HTML <tg-emoji>. */
function pe(key) {
  const item = EMOJI[key];
  if (!item) return '';
  const [id, fallback] = item;
  return `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>`;
}

/** Hapus semua tag <tg-emoji> -> sisakan fallback unicode di dalamnya. */
function stripPremium(html) {
  return String(html).replace(/<tg-emoji[^>]*>([\s\S]*?)<\/tg-emoji>/gi, '$1');
}

/** Apakah teks mengandung premium emoji? */
function hasPremium(html) {
  return /<tg-emoji[\s>]/i.test(String(html));
}

module.exports = { EMOJI, pe, stripPremium, hasPremium };
