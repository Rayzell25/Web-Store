'use strict';

const { config } = require('../config');

/** Keyboard inline menu utama. isAdminUser -> tampilkan tombol ADMIN */
function mainMenu(isAdminUser) {
  const rows = [
    [{ text: 'Beli Paket', callback_data: 'menu:order' }],
    [{ text: 'Top Up Saldo', callback_data: 'menu:deposit' }],
    [
      { text: 'Riwayat', callback_data: 'menu:riwayat' },
      { text: 'Cek Harga', callback_data: 'menu:stok' },
    ],
    [
      { text: 'Tools', callback_data: 'menu:tools' },
      { text: 'Bantuan', callback_data: 'menu:bantuan' },
    ],
  ];

  if (isAdminUser) {
    rows.push([{ text: 'Admin', callback_data: 'menu:admin' }]);
  } else if (config.store.adminContact) {
    rows.push([{ text: 'Admin', url: config.store.adminContact }]);
  }

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
