'use strict';

const { setState, clearState } = require('../utils/session');
const { backButton } = require('../keyboards/menus');
const { escapeHtml, LINE } = require('../utils/format');

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

async function showTools(bot, chatId, messageId) {
  const text = `<b>TOOLS</b>\n${LINE}\nPilih alat bantu:`;
  const keyboard = {
    inline_keyboard: [
      [{ text: '🔍 Cek Operator Nomor', callback_data: 'tools:operator' }],
      [{ text: '« Kembali', callback_data: 'menu:home' }],
    ],
  };
  await edit(bot, chatId, messageId, text, keyboard);
}

async function askOperator(bot, chatId, messageId, userId) {
  await setState(userId, 'tools:operator', {});
  await edit(bot, chatId, messageId,
    `<b>CEK OPERATOR</b>\n${LINE}\nKetik nomor HP yang ingin dicek (contoh: 081234567890):`,
    backButton('menu:tools'));
}

async function receiveOperatorCheck(bot, chatId, userId, number) {
  await clearState(userId);
  const op = detectOperator(number);
  const clean = String(number).replace(/[^\d]/g, '');
  const text = op
    ? `Nomor <code>${escapeHtml(clean)}</code>\nOperator: <b>${op}</b>`
    : `Nomor <code>${escapeHtml(clean)}</code>\nOperator tidak dikenali.`;
  await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: backButton('menu:home') });
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

module.exports = { showTools, askOperator, receiveOperatorCheck, detectOperator };
