'use strict';

const { getUserTransactions } = require('../services/trxService');
const { backButton } = require('../keyboards/menus');
const { rupiah, escapeHtml, tanggal, LINE } = require('../utils/format');

async function showRiwayat(bot, chatId, messageId, userId) {
  const trx = await getUserTransactions(userId, 10);
  let text = `<b>RIWAYAT TRANSAKSI</b>\n${LINE}\n`;
  if (!trx.length) {
    text += 'Belum ada transaksi.';
  } else {
    for (const t of trx) {
      const icon = t.status === 'Sukses' ? '✅' : t.status === 'Gagal' ? '✖' : '⏳';
      text +=
        `${icon} <b>${escapeHtml(t.product_name)}</b>\n` +
        `   ${escapeHtml(t.target)} · ${rupiah(t.sell_price)}\n` +
        (t.sn ? `   SN: <code>${escapeHtml(t.sn)}</code>\n` : '') +
        `   <code>${t.ref_id}</code> · ${tanggal(t.created_at)}\n`;
    }
  }
  await edit(bot, chatId, messageId, text, backButton('menu:home'));
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

module.exports = { showRiwayat };
