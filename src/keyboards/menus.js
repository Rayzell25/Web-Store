'use strict';

const { config } = require('../config');

/** Keyboard inline menu utama. isAdminUser -> tampilkan tombol ADMIN */
function mainMenu(isAdminUser) {
  const rows = [
    [{ text: '🛒 Beli Paket', callback_data: 'menu:order' }],
    [{ text: '💰 Saldo / Top Up', callback_data: 'menu:deposit' }],
    [
      { text: '📜 Riwayat', callback_data: 'menu:riwayat' },
      { text: '📦 Cek Stok', callback_data: 'menu:stok' },
    ],
    [
      { text: '🧰 Tools', callback_data: 'menu:tools' },
      { text: '❓ Bantuan', callback_data: 'menu:bantuan' },
    ],
  ];

  const lastRow = [];
  if (config.store.vpnUrl) {
    lastRow.push({ text: '🌐 BOT VPN', url: config.store.vpnUrl });
  }
  if (isAdminUser) {
    lastRow.push({ text: '⚙️ ADMIN', callback_data: 'menu:admin' });
  } else if (config.store.adminContact) {
    lastRow.push({ text: '👤 ADMIN', url: config.store.adminContact });
  }
  if (lastRow.length) rows.push(lastRow);

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
