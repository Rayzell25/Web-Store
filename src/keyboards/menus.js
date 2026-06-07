'use strict';

const { config } = require('../config');
const { iconId } = require('../utils/premoji');

/** Keyboard inline menu utama. (Tombol Admin dihapus; owner pakai /admin)
 *  Emoji tombol pakai field icon_custom_emoji_id (Bot API 9.4+); teks dibuat
 *  polos tanpa emoji unicode. Bila custom emoji belum didukung/eligible,
 *  ui.js otomatis menurunkan ke unicode (lihat downgradeButtonIcons).
 */
function mainMenu() {
  const rows = [];
  rows.push([{ text: 'Beli Paket', callback_data: 'menu:order', icon_custom_emoji_id: iconId('beli') }]);
  rows.push([{ text: 'Top Up Saldo', callback_data: 'menu:deposit', icon_custom_emoji_id: iconId('topup') }]);
  rows.push([
    { text: 'Riwayat', callback_data: 'menu:riwayat', icon_custom_emoji_id: iconId('riwayat') },
    { text: 'Cek Harga', callback_data: 'menu:stok', icon_custom_emoji_id: iconId('harga') },
  ]);
  rows.push([
    { text: 'Tools', callback_data: 'menu:tools', icon_custom_emoji_id: iconId('tools') },
    { text: 'Bantuan', callback_data: 'menu:bantuan', icon_custom_emoji_id: iconId('bantuan') },
  ]);
  if (config.webUrl) {
    const base = config.webUrl.replace(/\/+$/, '');
    rows.push([{ text: 'Buka Web', web_app: { url: `${base}/app.html` }, icon_custom_emoji_id: iconId('web') }]);
  }
  return { inline_keyboard: rows };
}

/** Tombol kembali ke menu utama */
function backButton(target = 'menu:home') {
  return { inline_keyboard: [[{ text: '« KEMBALI', callback_data: target }]] };
}

/** Bangun grid tombol dari list item {text, data}, kolom per baris */
function gridKeyboard(items, perRow = 2, backTarget = 'menu:home') {
  const rows = [];
  for (let i = 0; i < items.length; i += perRow) {
    rows.push(
      items.slice(i, i + perRow).map((it) => ({
        text: it.text,
        callback_data: it.data,
      }))
    );
  }
  if (backTarget) rows.push([{ text: '« KEMBALI', callback_data: backTarget }]);
  return { inline_keyboard: rows };
}

module.exports = { mainMenu, backButton, gridKeyboard };
