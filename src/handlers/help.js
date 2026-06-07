'use strict';

const { config } = require('../config');
const { escapeHtml, LINE } = require('../utils/format');
const { editOrSend } = require('../utils/ui');

async function showBantuan(bot, chatId, messageId) {
  const text =
    `<b>BANTUAN</b>\n${LINE}\n` +
    `<b>Cara order</b>\n` +
    `1. Pilih Beli Paket\n` +
    `2. Pilih kategori → brand → produk\n` +
    `3. Masukkan nomor tujuan\n` +
    `4. Konfirmasi & bayar pakai saldo\n\n` +
    `<b>Top up saldo</b>\n` +
    `Menu Top Up Saldo → pilih nominal → scan QRIS → saldo masuk otomatis.\n\n` +
    `<b>Catatan</b>\n` +
    `• Pastikan nomor tujuan benar sebelum bayar.\n` +
    `• Transaksi gagal otomatis refund saldo.\n` +
    `• Maintenance: ${escapeHtml(config.store.maintenance)}`;

  const rows = [];
  if (config.store.adminContact) rows.push([{ text: 'HUBUNGI ADMIN', url: config.store.adminContact }]);
  rows.push([{ text: '« KEMBALI', callback_data: 'menu:home' }]);

  return editOrSend(bot, chatId, messageId, text, { inline_keyboard: rows });
}

module.exports = { showBantuan };
