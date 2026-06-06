'use strict';

const { config, isAdmin } = require('../config');
const userService = require('../services/userService');
const trxService = require('../services/trxService');
const topupService = require('../services/topupService');
const productService = require('../services/productService');
const digiflazz = require('../services/digiflazz');
const { setState, clearState, getState } = require('../utils/session');
const { rupiah, escapeHtml, tanggal } = require('../utils/format');
const logger = require('../utils/logger');

function adminMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📊 Statistik', callback_data: 'adm:stats' }],
      [{ text: '🧾 Top Up Pending', callback_data: 'adm:topups' }],
      [
        { text: '➕ Saldo Manual', callback_data: 'adm:addsaldo' },
        { text: '🎖 Set Role', callback_data: 'adm:setrole' },
      ],
      [{ text: '🔄 Sync Produk', callback_data: 'adm:sync' }],
      [{ text: '📢 Broadcast', callback_data: 'adm:broadcast' }],
      [{ text: '« Kembali', callback_data: 'menu:home' }],
    ],
  };
}

async function showAdminMenu(bot, chatId, messageId, from) {
  if (!isAdmin(from.id)) return;
  const text = `⚙️ <b>PANEL ADMIN</b>\n━━━━━━━━━━━━━━━━━━━━\nPilih menu pengelolaan:`;
  await edit(bot, chatId, messageId, text, adminMenuKeyboard());
}

async function showStats(bot, chatId, messageId) {
  let deposit = null;
  try {
    deposit = await digiflazz.checkDeposit();
  } catch (e) {
    logger.warn('Cek deposit gagal:', e.message);
  }
  const text =
    `📊 <b>STATISTIK</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
    `👥 Total Pengguna: ${userService.countUsers()}\n` +
    `🧾 Total Transaksi: ${trxService.countTransactions()}\n` +
    `💰 Omzet Hari Ini: ${rupiah(trxService.todayRevenue())}\n` +
    `📦 Total Produk: ${productService.countProducts()}\n` +
    `🏦 Saldo Digiflazz: ${deposit != null ? rupiah(deposit) : '(gagal cek)'}`;
  await edit(bot, chatId, messageId, text, back('menu:admin'));
}

async function showPendingTopups(bot, chatId, messageId) {
  const list = topupService.pendingTopups(20);
  if (!list.length) {
    return edit(bot, chatId, messageId, '🧾 Tidak ada top up pending.', back('menu:admin'));
  }
  let text = `🧾 <b>TOP UP PENDING</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
  const rows = [];
  for (const t of list) {
    const u = userService.getUser(t.user_id);
    text += `\n#${t.id} • ${escapeHtml(u ? u.name : t.user_id)} • ${rupiah(t.amount)} • ${tanggal(t.created_at)}`;
    rows.push([
      { text: `✅ #${t.id}`, callback_data: `tu:ok:${t.id}` },
      { text: `❌ #${t.id}`, callback_data: `tu:no:${t.id}` },
    ]);
  }
  rows.push([{ text: '« Kembali', callback_data: 'menu:admin' }]);
  await edit(bot, chatId, messageId, text, { inline_keyboard: rows });
}

async function askAddSaldo(bot, chatId, messageId, userId) {
  setState(userId, 'adm:addsaldo', {});
  await edit(bot, chatId, messageId,
    '➕ <b>Saldo Manual</b>\n\nKetik: <code>ID_TELEGRAM NOMINAL</code>\nContoh: <code>123456789 50000</code>\n(Nominal boleh negatif untuk mengurangi)',
    back('menu:admin'));
}

async function askSetRole(bot, chatId, messageId, userId) {
  setState(userId, 'adm:setrole', {});
  await edit(bot, chatId, messageId,
    '🎖 <b>Set Role</b>\n\nKetik: <code>ID_TELEGRAM ROLE</code>\nROLE: MEMBER / RESELLER / ADMIN\nContoh: <code>123456789 RESELLER</code>',
    back('menu:admin'));
}

async function askBroadcast(bot, chatId, messageId, userId) {
  setState(userId, 'adm:broadcast', {});
  await edit(bot, chatId, messageId,
    '📢 <b>Broadcast</b>\n\nKetik pesan yang ingin dikirim ke semua pengguna:',
    back('menu:admin'));
}

async function syncProducts(bot, chatId, messageId) {
  await edit(bot, chatId, messageId, '🔄 Mengambil daftar produk dari Digiflazz...', null);
  try {
    const list = await digiflazz.priceList();
    const n = productService.upsertProducts(list);
    await edit(bot, chatId, messageId,
      `✅ Sync selesai. ${n} produk diperbarui.\nTotal produk: ${productService.countProducts()}`,
      back('menu:admin'));
  } catch (e) {
    logger.error('Sync produk gagal:', e.message);
    await edit(bot, chatId, messageId,
      `❌ Sync gagal: ${escapeHtml(e.message)}\n\nPastikan DIGIFLAZZ_USERNAME & DIGIFLAZZ_API_KEY benar.`,
      back('menu:admin'));
  }
}

/** Tangani input teks admin sesuai state. Return true jika ditangani. */
async function handleAdminText(bot, chatId, from, text, broadcastFn) {
  const state = getState(from.id);
  if (!state || !isAdmin(from.id)) return false;

  if (state.action === 'adm:addsaldo') {
    clearState(from.id);
    const m = String(text).trim().split(/\s+/);
    const targetId = Number(m[0]);
    const amount = parseInt(m[1], 10);
    if (!Number.isFinite(targetId) || !Number.isFinite(amount)) {
      await bot.sendMessage(chatId, '⚠️ Format salah. Contoh: 123456789 50000');
      return true;
    }
    if (!userService.getUser(targetId)) {
      await bot.sendMessage(chatId, '⚠️ User belum terdaftar (harus /start dulu).');
      return true;
    }
    try {
      const newBal = userService.addBalance(targetId, amount);
      await bot.sendMessage(chatId, `✅ Saldo ${targetId} kini ${rupiah(newBal)} (${amount >= 0 ? '+' : ''}${rupiah(amount)}).`);
      try {
        await bot.sendMessage(targetId,
          `💳 Saldo kamu disesuaikan admin: ${amount >= 0 ? '+' : ''}${rupiah(amount)}\nSaldo sekarang: ${rupiah(newBal)}`);
      } catch (e) { /* ignore */ }
    } catch (e) {
      await bot.sendMessage(chatId, `⚠️ ${e.message}`);
    }
    return true;
  }

  if (state.action === 'adm:setrole') {
    clearState(from.id);
    const m = String(text).trim().split(/\s+/);
    const targetId = Number(m[0]);
    const role = String(m[1] || '').toUpperCase();
    if (!Number.isFinite(targetId) || !['MEMBER', 'RESELLER', 'ADMIN'].includes(role)) {
      await bot.sendMessage(chatId, '⚠️ Format salah. Contoh: 123456789 RESELLER');
      return true;
    }
    if (!userService.getUser(targetId)) {
      await bot.sendMessage(chatId, '⚠️ User belum terdaftar (harus /start dulu).');
      return true;
    }
    userService.setRole(targetId, role);
    await bot.sendMessage(chatId, `✅ Role ${targetId} diubah menjadi ${role}.`);
    return true;
  }

  if (state.action === 'adm:broadcast') {
    clearState(from.id);
    await bot.sendMessage(chatId, '📢 Memulai broadcast...');
    const result = await broadcastFn(text);
    await bot.sendMessage(chatId, `✅ Broadcast selesai. Terkirim: ${result.sent}, Gagal: ${result.failed}.`);
    return true;
  }

  return false;
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

function back(target) {
  return { inline_keyboard: [[{ text: '« Kembali', callback_data: target }]] };
}

module.exports = {
  showAdminMenu,
  showStats,
  showPendingTopups,
  askAddSaldo,
  askSetRole,
  askBroadcast,
  syncProducts,
  handleAdminText,
};
