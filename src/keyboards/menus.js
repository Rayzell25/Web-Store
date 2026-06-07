'use strict';

const { config } = require('../config');
const { pe } = require('../utils/premoji');

/** Keyboard inline menu utama. (Tombol Admin dihapus; owner pakai /admin)
 *  EKSPERIMEN: premium emoji (<tg-emoji>) ditaruh langsung di teks tombol.
 *  Catatan: teks tombol = plain text, jadi besar kemungkinan tag muncul mentah.
 */
function mainMenu() {
  const rows = [];
  rows.push([{ text: `${pe('beli')} BELI PAKET`, callback_data: 'menu:order' }]);
  rows.push([{ text: `${pe('topup')} TOP UP`, callback_data: 'menu:deposit' }]);
  rows.push([
    { text: `${pe('riwayat')} RIWAYAT`, callback_data: 'menu:riwayat' },
    { text: `${pe('harga')} CEK HARGA`, callback_data: 'menu:stok' },
  ]);
  rows.push([
    { text: `${pe('tools')} TOOLS`, callback_data: 'menu:tools' },
    { text: `${pe('bantuan')} BANTUAN`, callback_data: 'menu:bantuan' },
  ]);
  if (config.webUrl) {
    const base = config.webUrl.replace(/\/+$/, '');
    rows.push([{ text: `${pe('web')} BUKA WEB`, web_app: { url: `${base}/app.html` } }]);
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
