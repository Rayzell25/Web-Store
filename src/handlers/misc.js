'use strict';

const { config } = require('../config');
const { getUserTransactions } = require('../services/trxService');
const { getUser } = require('../services/userService');
const { backButton } = require('../keyboards/menus');
const { rupiah, escapeHtml, tanggal } = require('../utils/format');

/** Deteksi operator dari prefix nomor HP Indonesia */
function detectOperator(number) {
  const n = String(number).replace(/[^\d]/g, '').replace(/^62/, '0');
  const prefix = n.slice(0, 4);
  const map = {
    Telkomsel: ['0811', '0812', '0813', '0821', '0822', '0823', '0851', '0852', '0853'],
    Indosat: ['0814', '0815', '0816', '0855', '0856', '0857', '0858'],
    XL: ['0817', '0818', '0819', '0859', '0877', '0878'],
    Axis: ['0831', '0832', '0833', '0838'],
    Tri: ['0895', '0896', '0897', '0898', '0899'],
    Smartfren: ['0881', '0882', '0883', '0884', '0885', '0886', '0887', '0888', '0889'],
  };
  for (const [op, prefixes] of Object.entries(map)) {
    if (prefixes.includes(prefix)) return op;
  }
  return null;
}

async function showRiwayat(bot, chatId, messageId, userId) {
  const trx = getUserTransactions(userId, 10);
  let text = `📜 <b>RIWAYAT TRANSAKSI</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
  if (!trx.length) {
    text += '\nBelum ada transaksi.';
  } else {
    for (const t of trx) {
      const icon = t.status === 'Sukses' ? '✅' : t.status === 'Gagal' ? '❌' : '⏳';
      text +=
        `\n${icon} <b>${escapeHtml(t.product_name)}</b>\n` +
        `🎯 ${escapeHtml(t.target)} • ${rupiah(t.sell_price)}\n` +
        (t.sn ? `🔑 <code>${escapeHtml(t.sn)}</code>\n` : '') +
        `🧾 <code>${t.ref_id}</code> • ${tanggal(t.created_at)}\n`;
    }
  }
  await edit(bot, chatId, messageId, text, backButton('menu:home'));
}

async function showTools(bot, chatId, messageId) {
  const text =
    `🧰 <b>TOOLS</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    `Pilih alat bantu:`;
  const keyboard = {
    inline_keyboard: [
      [{ text: '🔍 Cek Operator Nomor', callback_data: 'tools:operator' }],
      [{ text: '« Kembali', callback_data: 'menu:home' }],
    ],
  };
  await edit(bot, chatId, messageId, text, keyboard);
}

async function askOperator(bot, chatId, messageId, userId) {
  require('../utils/session').setState(userId, 'tools:operator', {});
  await edit(bot, chatId, messageId,
    '🔍 <b>Cek Operator</b>\n\nKetik nomor HP yang ingin dicek (contoh: 081234567890):',
    backButton('menu:tools'));
}

async function receiveOperatorCheck(bot, chatId, userId, number) {
  require('../utils/session').clearState(userId);
  const op = detectOperator(number);
  const clean = String(number).replace(/[^\d]/g, '');
  const text = op
    ? `🔍 Nomor <code>${escapeHtml(clean)}</code>\n📡 Operator: <b>${op}</b>`
    : `🔍 Nomor <code>${escapeHtml(clean)}</code>\n❓ Operator tidak dikenali.`;
  await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: backButton('menu:home') });
}

async function showBantuan(bot, chatId, messageId) {
  const text =
    `❓ <b>BANTUAN</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    `<b>Cara order:</b>\n` +
    `1. Pilih <b>Beli Paket</b>\n` +
    `2. Pilih kategori → brand → produk\n` +
    `3. Masukkan nomor tujuan\n` +
    `4. Konfirmasi & bayar pakai saldo\n\n` +
    `<b>Top up saldo:</b>\n` +
    `Menu <b>Saldo / Top Up</b> → masukkan nominal → transfer → konfirmasi admin.\n\n` +
    `<b>Catatan:</b>\n` +
    `• Pastikan nomor tujuan benar sebelum bayar.\n` +
    `• Transaksi gagal otomatis refund saldo.\n` +
    `• Maintenance: ${escapeHtml(config.store.maintenance)}\n\n` +
    (config.store.adminContact ? `Butuh bantuan? Hubungi admin.` : '');
  const rows = [];
  if (config.store.adminContact) rows.push([{ text: '👤 Hubungi Admin', url: config.store.adminContact }]);
  rows.push([{ text: '« Kembali', callback_data: 'menu:home' }]);
  await edit(bot, chatId, messageId, text, { inline_keyboard: rows });
}

async function edit(bot, chatId, messageId, text, replyMarkup) {
  const opts = { parse_mode: 'HTML' };
  if (replyMarkup) opts.reply_markup = replyMarkup;
  if (messageId) {
    try {
      return await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts });
    } catch (e) { /* fall through */ }
  }
  return bot.sendMessage(chatId, text, opts);
}

module.exports = {
  showRiwayat,
  showTools,
  askOperator,
  receiveOperatorCheck,
  showBantuan,
  detectOperator,
};
