'use strict';

const { config } = require('../config');
const { getUser, addBalance } = require('../services/userService');
const {
  createTopup,
  getTopup,
  setTopupStatus,
  userTopups,
} = require('../services/topupService');
const { setState, clearState, getState } = require('../utils/session');
const { backButton } = require('../keyboards/menus');
const { rupiah, escapeHtml, tanggal, ribuan } = require('../utils/format');

/** Tampilkan menu saldo + opsi top up */
async function showTopupMenu(bot, chatId, messageId, userId) {
  const user = getUser(userId);
  const history = userTopups(userId, 5);

  let histText = '';
  if (history.length) {
    histText = '\n\n📋 <b>Top Up Terakhir:</b>\n';
    for (const t of history) {
      const icon = t.status === 'Approved' ? '✅' : t.status === 'Rejected' ? '❌' : '⏳';
      histText += `${icon} ${rupiah(t.amount)} — ${t.status} (${tanggal(t.created_at)})\n`;
    }
  }

  const text =
    `💰 <b>SALDO / TOP UP</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💳 Saldo Kamu: <b>${rupiah(user.balance)}</b>\n` +
    `🎖 Role: ${escapeHtml(user.role)}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `Minimal top up: <b>${rupiah(config.topup.min)}</b>${histText}`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '➕ Top Up Saldo', callback_data: 'topup:new' }],
      [{ text: '« Kembali', callback_data: 'menu:home' }],
    ],
  };
  await edit(bot, chatId, messageId, text, keyboard);
}

/** Minta nominal top up */
async function askAmount(bot, chatId, messageId, userId) {
  setState(userId, 'topup:input_amount', {});
  const text =
    `➕ <b>TOP UP SALDO</b>\n\n` +
    `Ketik nominal yang ingin di-top up (angka saja).\n` +
    `Contoh: <code>50000</code>\n\n` +
    `Minimal: <b>${rupiah(config.topup.min)}</b>`;
  await edit(bot, chatId, messageId, text, backButton('menu:topup'));
}

/** Terima nominal -> buat request top up + instruksi pembayaran */
async function receiveAmount(bot, chatId, userId, text, notifyAdmins) {
  const state = getState(userId);
  if (!state || state.action !== 'topup:input_amount') return;

  const amount = parseInt(String(text).replace(/[^\d]/g, ''), 10);
  if (!Number.isFinite(amount) || amount <= 0) {
    return bot.sendMessage(chatId, '⚠️ Nominal tidak valid. Ketik angka saja, contoh: 50000');
  }
  if (amount < config.topup.min) {
    return bot.sendMessage(chatId, `⚠️ Minimal top up ${rupiah(config.topup.min)}.`);
  }

  clearState(userId);
  const topup = createTopup(userId, amount);
  const user = getUser(userId);

  const userText =
    `🧾 <b>PERMINTAAN TOP UP DIBUAT</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🆔 ID Top Up: <code>${topup.id}</code>\n` +
    `💵 Nominal: <b>${rupiah(amount)}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💳 <b>Transfer ke:</b>\n${escapeHtml(config.topup.info)}\n\n` +
    `Setelah transfer, kirim bukti ke admin. Saldo akan ditambahkan setelah dikonfirmasi admin.`;

  await bot.sendMessage(chatId, userText, {
    parse_mode: 'HTML',
    reply_markup: backButton('menu:home'),
  });

  // Notifikasi ke admin dengan tombol approve/reject
  if (typeof notifyAdmins === 'function') {
    const adminText =
      `🔔 <b>PERMINTAAN TOP UP</b>\n` +
      `🆔 #${topup.id}\n` +
      `👤 ${escapeHtml(user.name)} (<code>${userId}</code>)` +
      (user.username ? ` @${escapeHtml(user.username)}` : '') + `\n` +
      `💵 ${rupiah(amount)}\n` +
      `🕒 ${tanggal(topup.created_at)}`;
    const adminKb = {
      inline_keyboard: [
        [
          { text: '✅ Setujui', callback_data: `tu:ok:${topup.id}` },
          { text: '❌ Tolak', callback_data: `tu:no:${topup.id}` },
        ],
      ],
    };
    notifyAdmins(adminText, { parse_mode: 'HTML', reply_markup: adminKb });
  }
}

/** Admin menyetujui top up */
async function approve(bot, chatId, messageId, adminFrom, topupId) {
  const topup = getTopup(topupId);
  if (!topup) return answerEdit(bot, chatId, messageId, '⚠️ Top up tidak ditemukan.');
  if (topup.status !== 'Pending') {
    return answerEdit(bot, chatId, messageId, `ℹ️ Top up #${topupId} sudah ${topup.status}.`);
  }

  addBalance(topup.user_id, topup.amount);
  setTopupStatus(topupId, 'Approved', `oleh admin ${adminFrom.id}`);
  const user = getUser(topup.user_id);

  await answerEdit(bot, chatId, messageId,
    `✅ Top up #${topupId} disetujui.\n${user ? escapeHtml(user.name) : topup.user_id} +${rupiah(topup.amount)}\nSaldo sekarang: ${rupiah(user ? user.balance : 0)}`);

  // beri tahu user
  try {
    await bot.sendMessage(topup.user_id,
      `✅ <b>Top Up Disetujui</b>\nSaldo +${rupiah(topup.amount)} telah ditambahkan.\n💳 Saldo sekarang: <b>${rupiah(user.balance)}</b>`,
      { parse_mode: 'HTML' });
  } catch (e) { /* user mungkin blokir bot */ }
}

/** Admin menolak top up */
async function reject(bot, chatId, messageId, adminFrom, topupId) {
  const topup = getTopup(topupId);
  if (!topup) return answerEdit(bot, chatId, messageId, '⚠️ Top up tidak ditemukan.');
  if (topup.status !== 'Pending') {
    return answerEdit(bot, chatId, messageId, `ℹ️ Top up #${topupId} sudah ${topup.status}.`);
  }
  setTopupStatus(topupId, 'Rejected', `oleh admin ${adminFrom.id}`);
  await answerEdit(bot, chatId, messageId, `❌ Top up #${topupId} ditolak.`);
  try {
    await bot.sendMessage(topup.user_id,
      `❌ <b>Top Up Ditolak</b>\nPermintaan top up ${rupiah(topup.amount)} ditolak admin. Hubungi admin jika ada kendala.`,
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

module.exports = { showTopupMenu, askAmount, receiveAmount, approve, reject };
