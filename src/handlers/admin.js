'use strict';

const { isAdmin } = require('../config');
const userService = require('../services/userService');
const trxService = require('../services/trxService');
const depositService = require('../services/depositService');
const productService = require('../services/productService');
const markupService = require('../services/markupService');
const digiflazz = require('../services/digiflazz');
const { setState, clearState, getState } = require('../utils/session');
const { rupiah, escapeHtml, tanggal, LINE } = require('../utils/format');
const logger = require('../utils/logger');

function adminMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📊 Statistik', callback_data: 'adm:stats' }],
      [{ text: '🧾 Top Up Pending', callback_data: 'adm:deposits' }],
      [
        { text: '➕ Saldo Manual', callback_data: 'adm:addsaldo' },
        { text: '🎖 Set Role', callback_data: 'adm:setrole' },
      ],
      [
        { text: '🏷 Markup', callback_data: 'adm:markup' },
        { text: '🔄 Sync Produk', callback_data: 'adm:sync' },
      ],
      [{ text: '📢 Broadcast', callback_data: 'adm:broadcast' }],
      [{ text: '« Kembali', callback_data: 'menu:home' }],
    ],
  };
}

async function showAdminMenu(bot, chatId, messageId, from) {
  if (!isAdmin(from.id)) return;
  const text = `<b>PANEL ADMIN</b>\n${LINE}\nPilih menu pengelolaan:`;
  await edit(bot, chatId, messageId, text, adminMenuKeyboard());
}

async function showStats(bot, chatId, messageId) {
  let deposit = null;
  try {
    deposit = await digiflazz.checkDeposit();
  } catch (e) {
    logger.warn('Cek deposit gagal:', e.message);
  }
  const stat =
    `Pengguna  : ${userService.countUsers()}\n` +
    `Transaksi : ${trxService.countTransactions()}\n` +
    `Omzet ini : ${rupiah(trxService.todayRevenue())}\n` +
    `Produk    : ${productService.countProducts()}\n` +
    `Digiflazz : ${deposit != null ? rupiah(deposit) : '(gagal cek)'}`;
  const text = `<b>STATISTIK</b>\n${LINE}\n<code>${escapeHtml(stat)}</code>`;
  await edit(bot, chatId, messageId, text, back('menu:admin'));
}

async function showPendingDeposits(bot, chatId, messageId) {
  const list = depositService.pendingDeposits(20);
  if (!list.length) {
    return edit(bot, chatId, messageId, '🧾 Tidak ada top up pending.', back('menu:admin'));
  }
  let text = `<b>TOP UP PENDING</b>\n${LINE}\n`;
  const rows = [];
  for (const t of list) {
    const u = userService.getUser(t.user_id);
    text += `#${t.id} · ${escapeHtml(u ? u.name : t.user_id)} · ${rupiah(t.amount)} · ${tanggal(t.created_at)}\n`;
    rows.push([
      { text: `✅ #${t.id}`, callback_data: `dp:ok:${t.id}` },
      { text: `✖ #${t.id}`, callback_data: `dp:no:${t.id}` },
    ]);
  }
  rows.push([{ text: '« Kembali', callback_data: 'menu:admin' }]);
  await edit(bot, chatId, messageId, text, { inline_keyboard: rows });
}

async function askAddSaldo(bot, chatId, messageId, userId) {
  await setState(userId, 'adm:addsaldo', {});
  await edit(bot, chatId, messageId,
    `<b>SALDO MANUAL</b>\n${LINE}\nKetik: <code>ID_TELEGRAM NOMINAL</code>\nContoh: <code>123456789 50000</code>\n(Nominal boleh negatif untuk mengurangi)`,
    back('menu:admin'));
}

async function askSetRole(bot, chatId, messageId, userId) {
  await setState(userId, 'adm:setrole', {});
  await edit(bot, chatId, messageId,
    `<b>SET ROLE</b>\n${LINE}\nKetik: <code>ID_TELEGRAM ROLE</code>\nROLE: MEMBER / RESELLER / ADMIN\nContoh: <code>123456789 RESELLER</code>`,
    back('menu:admin'));
}

async function askBroadcast(bot, chatId, messageId, userId) {
  await setState(userId, 'adm:broadcast', {});
  await edit(bot, chatId, messageId,
    `<b>BROADCAST</b>\n${LINE}\nKetik pesan yang ingin dikirim ke semua pengguna:`,
    back('menu:admin'));
}

async function showMarkup(bot, chatId, messageId, userId) {
  await setState(userId, 'adm:markup', {});
  const help =
    `\n\n<b>Atur markup, ketik salah satu (pakai pemisah | ):</b>\n` +
    `<code>default|flat|500</code>\n` +
    `<code>default|percent|3</code>\n` +
    `<code>reseller|flat|250</code>\n` +
    `<code>cat|Paket Data|flat|1000</code>\n` +
    `<code>cat|PLN|flat|1500</code>\n` +
    `<code>sku|xld10|flat|800</code>\n` +
    `<code>round|100</code>\n` +
    `<code>delcat|Paket Data</code>\n` +
    `<code>delsku|xld10</code>\n\n` +
    `<i>type: flat (rupiah) atau percent (% dari modal)</i>`;
  await edit(bot, chatId, messageId, markupService.describe() + help, back('menu:admin'));
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
  const state = await getState(from.id);
  if (!state || !isAdmin(from.id)) return false;

  if (state.action === 'adm:addsaldo') {
    await clearState(from.id);
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
    await clearState(from.id);
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

  if (state.action === 'adm:markup') {
    await clearState(from.id);
    const out = applyMarkupCommand(text);
    await bot.sendMessage(chatId, out, { parse_mode: 'HTML' });
    return true;
  }

  if (state.action === 'adm:broadcast') {
    await clearState(from.id);
    await bot.sendMessage(chatId, '📢 Memulai broadcast...');
    const result = await broadcastFn(text);
    await bot.sendMessage(chatId, `✅ Broadcast selesai. Terkirim: ${result.sent}, Gagal: ${result.failed}.`);
    return true;
  }

  return false;
}

/** Parser perintah markup (pemisah |). */
function applyMarkupCommand(text) {
  const parts = String(text).split('|').map((s) => s.trim());
  const cmd = (parts[0] || '').toLowerCase();
  const validType = (t) => ['flat', 'percent'].includes(String(t).toLowerCase());

  try {
    if (cmd === 'default' || cmd === 'reseller') {
      if (!validType(parts[1]) || isNaN(Number(parts[2]))) return '⚠️ Format: default|flat|500';
      markupService.setRule(cmd, parts[1].toLowerCase(), Number(parts[2]));
      return `✅ Markup ${cmd} di-set ke ${parts[1]} ${parts[2]}.`;
    }
    if (cmd === 'cat') {
      const category = parts[1];
      if (!category || !validType(parts[2]) || isNaN(Number(parts[3]))) return '⚠️ Format: cat|Paket Data|flat|1000';
      markupService.setRule('category', parts[2].toLowerCase(), Number(parts[3]), category);
      return `✅ Markup kategori "${escapeHtml(category)}" di-set ke ${parts[2]} ${parts[3]}.`;
    }
    if (cmd === 'sku') {
      const sku = parts[1];
      if (!sku || !validType(parts[2]) || isNaN(Number(parts[3]))) return '⚠️ Format: sku|xld10|flat|800';
      markupService.setProductMarkup(sku, parts[2].toLowerCase(), Number(parts[3]));
      return `✅ Markup produk "${escapeHtml(sku)}" di-set ke ${parts[2]} ${parts[3]}.`;
    }
    if (cmd === 'round') {
      if (isNaN(Number(parts[1]))) return '⚠️ Format: round|100';
      markupService.setRound(Number(parts[1]));
      return `✅ Pembulatan di-set ke kelipatan ${parts[1]}.`;
    }
    if (cmd === 'delcat') {
      if (!parts[1]) return '⚠️ Format: delcat|Paket Data';
      markupService.deleteCategoryRule(parts[1]);
      return `✅ Markup kategori "${escapeHtml(parts[1])}" dihapus.`;
    }
    if (cmd === 'delsku') {
      if (!parts[1]) return '⚠️ Format: delsku|xld10';
      markupService.deleteProductMarkup(parts[1]);
      return `✅ Markup produk "${escapeHtml(parts[1])}" dihapus.`;
    }
    return '⚠️ Perintah tidak dikenali. Buka menu Markup lagi untuk lihat format.';
  } catch (e) {
    return `⚠️ Gagal: ${escapeHtml(e.message)}`;
  }
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
  showPendingDeposits,
  askAddSaldo,
  askSetRole,
  askBroadcast,
  showMarkup,
  syncProducts,
  handleAdminText,
};
