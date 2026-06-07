'use strict';

const { config } = require('../config');
const { getUser, addBalance } = require('../services/userService');
const {
  createDeposit,
  getDeposit,
  setDepositStatus,
} = require('../services/depositService');
const autogopay = require('../services/autogopay');
const qrisService = require('../services/qrisService');
const { setState, clearState, getState } = require('../utils/session');
const { backButton } = require('../keyboards/menus');
const { rupiah, escapeHtml, tanggal, LINE } = require('../utils/format');
const { editOrSend: edit } = require('../utils/ui');

const PRESETS = [10000, 20000, 50000, 100000, 200000, 500000];

/** Kirim pesan lalu hapus otomatis setelah ttlSec detik (default 15). */
async function sendAutoDelete(bot, chatId, text, ttlSec = 15) {
  const sent = await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
  setTimeout(() => {
    bot.deleteMessage(chatId, sent.message_id).catch(() => {});
  }, Math.max(1, ttlSec) * 1000);
  return sent;
}

/** Menu utama Top Up: saldo + preset nominal. */
async function showDepositMenu(bot, chatId, messageId, userId) {
  const user = await getUser(userId);

  const akun =
    `Saldo kamu : ${rupiah(user.balance)}\n` +
    `Role       : ${user.role}`;

  const text =
    `<b>SALDO</b>\n${LINE}\n` +
    `<code>${escapeHtml(akun)}</code>\n` +
    `Gunakan saldo untuk beli paket tanpa scan QRIS tiap kali.\n` +
    `${LINE}\n` +
    `<b>TOP UP SALDO</b>\n` +
    `Pilih nominal, atau "Nominal Lain" untuk custom:`;

  const rows = [];
  for (let i = 0; i < PRESETS.length; i += 2) {
    rows.push(
      PRESETS.slice(i, i + 2).map((n) => ({
        text: rupiah(n),
        callback_data: `deposit:nom:${n}`,
      }))
    );
  }
  rows.push([{ text: 'NOMINAL LAIN', callback_data: 'deposit:custom' }]);
  rows.push([{ text: '« KEMBALI', callback_data: 'menu:home' }]);

  await edit(bot, chatId, messageId, text, { inline_keyboard: rows });
}

/** Nominal preset dipilih -> langsung tampilkan QRIS. */
async function chooseNominal(bot, chatId, messageId, userId, amount, notifyAdmins) {
  const amt = parseInt(amount, 10);
  if (!Number.isFinite(amt) || amt <= 0) {
    return edit(bot, chatId, messageId,
      `⚠️ Nominal tidak valid.`, backButton('menu:deposit'));
  }
  await startQrisTopup(bot, chatId, messageId, userId, amt);
}

/** "Nominal Lain" -> minta user ketik angka. */
async function askAmount(bot, chatId, messageId, userId) {
  await setState(userId, 'deposit:input_amount', {});
  const text =
    `<b>TOP UP SALDO</b>\n${LINE}\n` +
    `Ketik nominal yang ingin di-top up (angka saja).\n` +
    `Contoh: <code>75000</code>`;
  await edit(bot, chatId, messageId, text, backButton('menu:deposit'));
}

async function receiveAmount(bot, chatId, userId, text, notifyAdmins) {
  const state = await getState(userId);
  if (!state || state.action !== 'deposit:input_amount') return;

  const amount = parseInt(String(text).replace(/[^\d]/g, ''), 10);
  if (!Number.isFinite(amount) || amount <= 0) {
    return bot.sendMessage(chatId, '⚠️ Nominal tidak valid. Ketik angka saja, contoh: 75000');
  }
  if (amount < config.topup.min) {
    return sendAutoDelete(bot, chatId, `⚠️ Minimal top up ${rupiah(config.topup.min)}.`);
  }
  await startQrisTopup(bot, chatId, null, userId, amount);
}

/** Top up via QRIS otomatis langsung dari nominal (saldo masuk sendiri setelah bayar). */
async function startQrisTopup(bot, chatId, messageId, userId, amount) {
  await clearState(userId);

  if (!config.qris.enabled) {
    return edit(bot, chatId, messageId, '⚠️ QRIS sedang tidak tersedia.', backButton('menu:deposit'));
  }

  const { total, fee } = autogopay.computeTotal(amount);

  let qr;
  try {
    qr = await autogopay.generateQris(total);
  } catch (e) {
    return edit(bot, chatId, messageId, `⚠️ Gagal membuat QRIS: ${escapeHtml(e.message)}`, backButton('menu:deposit'));
  }

  if (messageId) { try { await bot.deleteMessage(chatId, messageId); } catch (e) { /* ignore */ } }

  const caption =
    `<b>TOP UP via QRIS</b>\n${LINE}\n` +
    `<code>${escapeHtml(`Nominal : ${rupiah(amount)}`)}</code>\n` +
    `${LINE}\nScan & bayar. Saldo +${rupiah(amount)} masuk otomatis setelah pembayaran.`;

  const kb = {
    inline_keyboard: [
      [
        { text: 'CEK SEKARANG', callback_data: `qris:check:${qr.transaction_id}` },
        { text: 'BATAL', callback_data: `qris:cancel:${qr.transaction_id}` },
      ],
    ],
  };

  const sent = await bot.sendPhoto(chatId, qr.qr_url, { caption, parse_mode: 'HTML', reply_markup: kb });

  await qrisService.create({
    transaction_id: qr.transaction_id,
    order_id: qr.order_id,
    user_id: userId,
    chat_id: chatId,
    message_id: sent.message_id,
    purpose: 'topup',
    base_amount: amount,
    fee,
    amount: total,
    payload: { nominal: amount },
    expiry_at: autogopay.parseExpiry(qr.expiry_time),
  });
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

async function answerEdit(bot, chatId, messageId, text) {
  return edit(bot, chatId, messageId, text, null);
}

module.exports = {
  showDepositMenu,
  chooseNominal,
  askAmount,
  receiveAmount,
  approve,
  reject,
};
