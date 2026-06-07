'use strict';

const { config } = require('../config');

/** [TES] Keyboard inline menu utama memakai icon_custom_emoji_id (Bot API).
 *  CATATAN: berdasarkan dokumentasi resmi & tes langsung sebelumnya, Telegram
 *  mengabaikan field ini di tombol -> kemungkinan besar tombol tampil sebagai
 *  teks polos TANPA emoji. Branch ini khusus untuk diuji owner.
 */
function mainMenu() {
  const rows = [];
  rows.push([{ text: 'Beli Paket', callback_data: 'menu:order', icon_custom_emoji_id: '5864095106096698177' }]);
  rows.push([{ text: 'Top Up Saldo', callback_data: 'menu:deposit', icon_custom_emoji_id: '5445353829304387411' }]);
  rows.push([
    { text: 'Riwayat', callback_data: 'menu:riwayat', icon_custom_emoji_id: '5215209935188534658' },
    { text: 'Cek Harga', callback_data: 'menu:stok', icon_custom_emoji_id: '5231012545799666522' },
  ]);
  rows.push([
    { text: 'Tools', callback_data: 'menu:tools', icon_custom_emoji_id: '4920401966946845302' },
    { text: 'Bantuan', callback_data: 'menu:bantuan', icon_custom_emoji_id: '5215538577496090960' },
  ]);
  if (config.webUrl) {
    const base = config.webUrl.replace(/\/+$/, '');
    rows.push([{ text: 'Buka Web', web_app: { url: `${base}/app.html` }, icon_custom_emoji_id: '5375346433610235523' }]);
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
