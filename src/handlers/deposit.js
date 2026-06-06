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

const PRESETS = [10000, 20000, 50000, 100000, 200000, 500000];

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
  rows.push([{ text: 'Nominal Lain', callback_data: 'deposit:custom' }]);
  rows.push([{ text: '« Kembali', callback_data: 'menu:home' }]);

  await edit(bot, chatId, messageId, text, { inline_keyboard: rows });
}

/** Nominal preset dipilih -> langsung ke pilih metode. */
async function chooseNominal(bot, chatId, messageId, userId, amount, notifyAdmins) {
  const amt = parseInt(amount, 10);
  if (!Number.isFinite(amt) || amt < config.topup.min) {
    return edit(bot, chatId, messageId,
      `⚠️ Minimal top up ${rupiah(config.topup.min)}.`, backButton('menu:deposit'));
  }
  await presentMethod(bot, chatId, messageId, userId, amt, notifyAdmins);
}

/** "Nominal Lain" -> minta user ketik angka. */
async function askAmount(bot, chatId, messageId, userId) {
  await setState(userId, 'deposit:input_amount', {});
  const text =
    `<b>TOP UP SALDO</b>\n${LINE}\n` +
    `Ketik nominal yang ingin di-top up (angka saja).\n` +
    `Contoh: <code>75000</code>\n\n` +
    `Minimal: <b>${rupiah(config.topup.min)}</b>`;
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
    return bot.sendMessage(chatId, `⚠️ Minimal top up ${rupiah(config.topup.min)}.`);
  }
  await presentMethod(bot, chatId, null, userId, amount, notifyAdmins);
}

/** Tampilkan pilihan metode (QRIS / Transfer Manual) untuk sebuah nominal. */
async function presentMethod(bot, chatId, messageId, userId, amount, notifyAdmins) {
  // QRIS mati -> langsung buat tagihan manual
  if (!config.qris.enabled) {
    await clearState(userId);
    if (messageId) { try { await bot.deleteMessage(chatId, messageId); } catch (e) { /* ignore */ } }
    return createManualDeposit(bot, chatId, userId, amount, notifyAdmins);
  }

  await setState(userId, 'deposit:method', { amount });
  const { total, fee } = autogopay.computeTotal(amount);
  const info =
    `Nominal : ${rupiah(amount)}\n` +
    `Via QRIS: bayar ${rupiah(total)} (fee ${rupiah(fee)})`;
  const kb = {
    inline_keyboard: [
      [
        { text: 'QRIS', callback_data: 'deposit:qris' },
        { text: 'Transfer Manual', callback_data: 'deposit:manual' },
      ],
      [{ text: '« Kembali', callback_data: 'menu:deposit' }],
    ],
  };
  const text =
    `<b>PILIH METODE TOP UP</b>\n${LINE}\n<code>${escapeHtml(info)}</code>\n${LINE}\n` +
    `Saldo masuk penuh ${rupiah(amount)} setelah pembayaran.`;
  await edit(bot, chatId, messageId, text, kb);
}

/** Top up via transfer manual (perlu approve admin). */
async function chooseManual(bot, chatId, messageId, userId, notifyAdmins) {
  const state = await getState(userId);
  if (!state || state.action !== 'deposit:method') {
    return edit(bot, chatId, messageId, '⚠️ Sesi top up kedaluwarsa. Ulangi dari menu.', backButton('menu:deposit'));
  }
  const amount = state.data.amount;
  await clearState(userId);
  try { await bot.deleteMessage(chatId, messageId); } catch (e) { /* ignore */ }
  await createManualDeposit(bot, chatId, userId, amount, notifyAdmins);
}

async function createManualDeposit(bot, chatId, userId, amount, notifyAdmins) {
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
    const ainfo =
      `#${deposit.id}\n` +
      `User : ${user.name} (${userId})` +
      (user.username ? ` @${user.username}` : '') + `\n` +
      `Nilai: ${rupiah(amount)}\n` +
      `Waktu: ${tanggal(deposit.created_at)}`;
    const adminKb = {
      inline_keyboard: [
        [
          { text: 'Setujui', callback_data: `dp:ok:${deposit.id}` },
          { text: 'Tolak', callback_data: `dp:no:${deposit.id}` },
        ],
      ],
    };
    notifyAdmins(`<b>PERMINTAAN TOP UP</b> 🔔\n${LINE}\n<code>${escapeHtml(ainfo)}</code>`,
      { parse_mode: 'HTML', reply_markup: adminKb });
  }
}

/** Top up via QRIS otomatis (saldo masuk sendiri setelah bayar). */
async function chooseQris(bot, chatId, messageId, userId) {
  if (!config.qris.enabled) {
    return edit(bot, chatId, messageId, '⚠️ QRIS sedang tidak tersedia.', backButton('menu:deposit'));
  }
  const state = await getState(userId);
  if (!state || state.action !== 'deposit:method') {
    return edit(bot, chatId, messageId, '⚠️ Sesi top up kedaluwarsa. Ulangi dari menu.', backButton('menu:deposit'));
  }
  const amount = state.data.amount;
  const { fee, total } = autogopay.computeTotal(amount);
  await clearState(userId);

  let qr;
  try {
    qr = await autogopay.generateQris(total);
  } catch (e) {
    return edit(bot, chatId, messageId, `⚠️ Gagal membuat QRIS: ${escapeHtml(e.message)}`, backButton('menu:deposit'));
  }

  try { await bot.deleteMessage(chatId, messageId); } catch (e) { /* ignore */ }

  const caption =
    `<b>TOP UP via QRIS</b>\n${LINE}\n` +
    `<code>${escapeHtml(
      `Nominal : ${rupiah(amount)}\n` +
      `Fee     : ${rupiah(fee)}\n` +
      `Total   : ${rupiah(total)}`
    )}</code>\n` +
    `${LINE}\nScan & bayar. Saldo +${rupiah(amount)} masuk otomatis setelah pembayaran.`;

  const kb = {
    inline_keyboard: [
      [
        { text: 'Cek Sekarang', callback_data: `qris:check:${qr.transaction_id}` },
        { text: 'Batal', callback_data: `qris:cancel:${qr.transaction_id}` },
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

module.exports = {
  showDepositMenu,
  chooseNominal,
  askAmount,
  receiveAmount,
  chooseManual,
  chooseQris,
  approve,
  reject,
};
