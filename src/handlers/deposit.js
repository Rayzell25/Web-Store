'use strict';

const { config } = require('../config');
const { getUser, addBalance } = require('../services/userService');
const {
  createDeposit,
  getDeposit,
  setDepositStatus,
  userDeposits,
} = require('../services/depositService');
const { setState, clearState, getState } = require('../utils/session');
const { backButton } = require('../keyboards/menus');
const { rupiah, escapeHtml, tanggal, LINE } = require('../utils/format');

async function showDepositMenu(bot, chatId, messageId, userId) {
  const user = await getUser(userId);
  const history = await userDeposits(userId, 5);

  let histText = '';
  if (history.length) {
    histText = `\n${LINE}\n<b>Top Up Terakhir</b>\n`;
    for (const t of history) {
      const icon = t.status === 'Approved' ? '✅' : t.status === 'Rejected' ? '✖' : '⏳';
      histText += `${icon} ${rupiah(t.amount)} · ${t.status} · ${tanggal(t.created_at)}\n`;
    }
  }

  const akun =
    `Saldo : ${rupiah(user.balance)}\n` +
    `Role  : ${user.role}\n` +
    `Min.  : ${rupiah(config.topup.min)}`;

  const text =
    `<b>SALDO / TOP UP</b>\n` +
    `${LINE}\n` +
    `<code>${escapeHtml(akun)}</code>\n${histText}`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '➕ Top Up Saldo', callback_data: 'deposit:new' }],
      [{ text: '« Kembali', callback_data: 'menu:home' }],
    ],
  };
  await edit(bot, chatId, messageId, text, keyboard);
}

async function askAmount(bot, chatId, messageId, userId) {
  await setState(userId, 'deposit:input_amount', {});
  const text =
    `<b>TOP UP SALDO</b>\n${LINE}\n` +
    `Ketik nominal yang ingin di-top up (angka saja).\n` +
    `Contoh: <code>50000</code>\n\n` +
    `Minimal: <b>${rupiah(config.topup.min)}</b>`;
  await edit(bot, chatId, messageId, text, backButton('menu:deposit'));
}

async function receiveAmount(bot, chatId, userId, text, notifyAdmins) {
  const state = await getState(userId);
  if (!state || state.action !== 'deposit:input_amount') return;

  const amount = parseInt(String(text).replace(/[^\d]/g, ''), 10);
  if (!Number.isFinite(amount) || amount <= 0) {
    return bot.sendMessage(chatId, '⚠️ Nominal tidak valid. Ketik angka saja, contoh: 50000');
  }
  if (amount < config.topup.min) {
    return bot.sendMessage(chatId, `⚠️ Minimal top up ${rupiah(config.topup.min)}.`);
  }

  await clearState(userId);
  const deposit = await createDeposit(userId, amount);
  const user = await getUser(userId);

  const info =
    `ID     : ${deposit.id}\n` +
    `Nominal: ${rupiah(amount)}`;
  const userText =
    `<b>PERMINTAAN TOP UP DIBUAT</b>\n` +
    `${LINE}\n` +
    `<code>${escapeHtml(info)}</code>\n` +
    `${LINE}\n` +
    `<b>Transfer ke:</b>\n${escapeHtml(config.topup.info)}\n\n` +
    `Setelah transfer, kirim bukti ke admin. Saldo masuk setelah dikonfirmasi.`;

  await bot.sendMessage(chatId, userText, { parse_mode: 'HTML', reply_markup: backButton('menu:home') });

  if (typeof notifyAdmins === 'function') {
    const info =
      `#${deposit.id}\n` +
      `User : ${user.name} (${userId})` +
      (user.username ? ` @${user.username}` : '') + `\n` +
      `Nilai: ${rupiah(amount)}\n` +
      `Waktu: ${tanggal(deposit.created_at)}`;
    const adminText =
      `<b>PERMINTAAN TOP UP</b> 🔔\n${LINE}\n<code>${escapeHtml(info)}</code>`;
    const adminKb = {
      inline_keyboard: [
        [
          { text: '✅ Setujui', callback_data: `dp:ok:${deposit.id}` },
          { text: '✖ Tolak', callback_data: `dp:no:${deposit.id}` },
        ],
      ],
    };
    notifyAdmins(adminText, { parse_mode: 'HTML', reply_markup: adminKb });
  }
}

async function approve(bot, chatId, messageId, adminFrom, depositId) {
  const deposit = await getDeposit(depositId);
  if (!deposit) return answerEdit(bot, chatId, messageId, '⚠️ Deposit tidak ditemukan.');
  if (deposit.status !== 'Pending') {
    return answerEdit(bot, chatId, messageId, `ℹ️ Deposit #${depositId} sudah ${deposit.status}.`);
  }

  await addBalance(deposit.user_id, deposit.amount);
  await setDepositStatus(depositId, 'Approved', `oleh admin ${adminFrom.id}`);
  const user = await getUser(deposit.user_id);

  await answerEdit(bot, chatId, messageId,
    `✅ Deposit #${depositId} disetujui.\n${user ? escapeHtml(user.name) : deposit.user_id} +${rupiah(deposit.amount)}\nSaldo sekarang: ${rupiah(user ? user.balance : 0)}`);

  try {
    await bot.sendMessage(deposit.user_id,
      `<b>TOP UP DISETUJUI</b> ✅\n${LINE}\nSaldo +${rupiah(deposit.amount)} ditambahkan.\nSaldo sekarang: <b>${rupiah(user.balance)}</b>`,
      { parse_mode: 'HTML' });
  } catch (e) { /* user mungkin blokir bot */ }
}

async function reject(bot, chatId, messageId, adminFrom, depositId) {
  const deposit = await getDeposit(depositId);
  if (!deposit) return answerEdit(bot, chatId, messageId, '⚠️ Deposit tidak ditemukan.');
  if (deposit.status !== 'Pending') {
    return answerEdit(bot, chatId, messageId, `ℹ️ Deposit #${depositId} sudah ${deposit.status}.`);
  }
  await setDepositStatus(depositId, 'Rejected', `oleh admin ${adminFrom.id}`);
  await answerEdit(bot, chatId, messageId, `❌ Deposit #${depositId} ditolak.`);
  try {
    await bot.sendMessage(deposit.user_id,
      `<b>TOP UP DITOLAK</b> ✖\n${LINE}\nPermintaan ${rupiah(deposit.amount)} ditolak admin. Hubungi admin jika ada kendala.`,
      { parse_mode: 'HTML' });
  } catch (e) { /* ignore */ }
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

async function answerEdit(bot, chatId, messageId, text) {
  try {
    await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' });
  } catch (e) {
    await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
  }
}

module.exports = { showDepositMenu, askAmount, receiveAmount, approve, reject };
