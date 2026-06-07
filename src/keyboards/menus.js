'use strict';

const { config } = require('../config');

/** Keyboard inline menu utama. (Tombol Admin dihapus; owner pakai /admin) */
function mainMenu() {
  const rows = [];
  if (config.webUrl) {
    const base = config.webUrl.replace(/\/+$/, '');
    rows.push([{ text: 'Belanja via Web', web_app: { url: `${base}/app.html` } }]);
  }
  rows.push([{ text: 'Beli Paket', callback_data: 'menu:order' }]);
  rows.push([{ text: 'Top Up', callback_data: 'menu:deposit' }]);
  rows.push([
    { text: 'Riwayat', callback_data: 'menu:riwayat' },
    { text: 'Cek Harga', callback_data: 'menu:stok' },
  ]);
  rows.push([
    { text: 'Tools', callback_data: 'menu:tools' },
    { text: 'Bantuan', callback_data: 'menu:bantuan' },
  ]);
  return { inline_keyboard: rows };
}

/** Tombol kembali ke menu utama */
function backButton(target = 'menu:home') {
  return { inline_keyboard: [[{ text: '« Kembali', callback_data: target }]] };
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
  if (backTarget) rows.push([{ text: '« Kembali', callback_data: backTarget }]);
  return { inline_keyboard: rows };
}

module.exports = { mainMenu, backButton, gridKeyboard };
