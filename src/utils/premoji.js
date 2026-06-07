'use strict';

/**
 * Premium / custom emoji Telegram.
 *
 * CATATAN:
 *  - Di TEKS pesan / caption: pakai pe() -> tag <tg-emoji> (parse_mode HTML).
 *  - Di TOMBOL (Bot API 9.4+): pakai iconId() -> field `icon_custom_emoji_id`.
 *    (Cara lama menaruh <tg-emoji> di teks tombol TIDAK bisa & bocor.)
 *  - Syarat custom emoji tampil: bot punya username Fragment ATAU owner bot
 *    Telegram Premium; dan jika pakai Local Bot API, server harus >= 9.4.
 *    Kalau belum terpenuhi, util ui.js otomatis menurunkan ke unicode
 *    (downgradeButtonIcons / stripPremium) supaya menu tetap tampil, tidak error.
 *
 * ID di bawah ini diisi oleh owner (sudah di-generate, bukan asal).
 * Tiap entri: [emoji-id, fallback-unicode].
 */
const EMOJI = {
  beli:    ['5864095106096698177', '🛒'],
  topup:   ['5445353829304387411', '💰'],
  riwayat: ['5215209935188534658', '🧾'],
  harga:   ['5231012545799666522', '🏷️'],
  tools:   ['4920401966946845302', '🛠️'],
  bantuan: ['5215538577496090960', '💬'],
  web:     ['5375346433610235523', '🌐'],
};

// Peta balik id -> unicode, untuk downgrade tombol bila custom emoji ditolak.
const ID_TO_UNI = {};
for (const [, [id, uni]] of Object.entries(EMOJI)) ID_TO_UNI[id] = uni;

/** Render satu premium emoji jadi tag HTML <tg-emoji>. (untuk TEKS pesan) */
function pe(key) {
  const item = EMOJI[key];
  if (!item) return '';
  const [id, fallback] = item;
  return `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>`;
}

/** ID custom emoji untuk dipasang di TOMBOL via field icon_custom_emoji_id. */
function iconId(key) {
  const item = EMOJI[key];
  return item ? item[0] : undefined;
}

/** Apakah reply_markup punya tombol ber-icon_custom_emoji_id? */
function markupHasButtonIcon(rm) {
  return !!(
    rm &&
    Array.isArray(rm.inline_keyboard) &&
    rm.inline_keyboard.some(
      (row) => Array.isArray(row) && row.some((b) => b && b.icon_custom_emoji_id)
    )
  );
}

/**
 * Turunkan tombol: buang icon_custom_emoji_id, sisipkan emoji unicode di depan
 * teks. Dipakai sebagai fallback bila Telegram menolak custom emoji di tombol.
 */
function downgradeButtonIcons(rm) {
  if (!markupHasButtonIcon(rm)) return rm;
  return {
    ...rm,
    inline_keyboard: rm.inline_keyboard.map((row) =>
      (Array.isArray(row) ? row : []).map((b) => {
        if (b && b.icon_custom_emoji_id) {
          const uni = ID_TO_UNI[b.icon_custom_emoji_id] || '';
          const { icon_custom_emoji_id, ...rest } = b;
          return { ...rest, text: uni ? `${uni} ${b.text}` : b.text };
        }
        return b;
      })
    ),
  };
}

/** Hapus semua tag <tg-emoji> -> sisakan fallback unicode di dalamnya. */
function stripPremium(html) {
  return String(html).replace(/<tg-emoji[^>]*>([\s\S]*?)<\/tg-emoji>/gi, '$1');
}

/** Apakah teks mengandung premium emoji? */
function hasPremium(html) {
  return /<tg-emoji[\s>]/i.test(String(html));
}

module.exports = {
  EMOJI,
  pe,
  iconId,
  markupHasButtonIcon,
  downgradeButtonIcons,
  stripPremium,
  hasPremium,
};
