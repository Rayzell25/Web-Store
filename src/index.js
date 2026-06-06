'use strict';

const TelegramBot = require('node-telegram-bot-api');
const { config, isAdmin, assertConfig } = require('./config');
const { init: initDb } = require('./db/database');
const logger = require('./utils/logger');

const userService = require('./services/userService');
const { getState, clearState } = require('./utils/session');

const start = require('./handlers/start');
const beli = require('./handlers/beliPaket');
const topup = require('./handlers/topup');
const misc = require('./handlers/misc');
const admin = require('./handlers/admin');

assertConfig();
initDb();

const bot = new TelegramBot(config.botToken, { polling: true });

// ===== Helper: kirim notifikasi ke semua admin =====
function notifyAdmins(text, opts = {}) {
  for (const id of config.adminIds) {
    bot.sendMessage(id, text, { parse_mode: 'HTML', ...opts }).catch(() => {});
  }
}

// ===== Helper: broadcast ke semua user =====
async function broadcast(text) {
  const ids = userService.allUserIds();
  let sent = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      await bot.sendMessage(id, text);
      sent += 1;
    } catch (e) {
      failed += 1;
    }
    // jeda kecil agar tidak kena rate limit
    await new Promise((r) => setTimeout(r, 40));
  }
  return { sent, failed };
}

// ===== /start & /menu =====
bot.onText(/^\/(start|menu)\b/, (msg) => {
  clearState(msg.from.id);
  start.sendMainMenu(bot, msg.chat.id, msg.from).catch((e) => logger.error(e));
});

// ===== /saldo shortcut =====
bot.onText(/^\/saldo\b/, (msg) => {
  const u = userService.ensureUser(msg.from);
  bot.sendMessage(msg.chat.id, `💳 Saldo kamu: ${require('./utils/format').rupiah(u.balance)}`);
});

// ===== /id shortcut =====
bot.onText(/^\/id\b/, (msg) => {
  bot.sendMessage(msg.chat.id, `🆔 ID Telegram kamu: <code>${msg.from.id}</code>`, { parse_mode: 'HTML' });
});

// ===== Pesan teks (alur multi-langkah) =====
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const userId = msg.from.id;
  const chatId = msg.chat.id;

  // pastikan user terdaftar
  userService.ensureUser(msg.from);

  // admin input dulu
  try {
    const handled = await admin.handleAdminText(bot, chatId, msg.from, msg.text, broadcast);
    if (handled) return;
  } catch (e) {
    logger.error('admin text error:', e.message);
  }

  const state = getState(userId);
  if (!state) return;

  try {
    if (state.action === 'beli:input_target') {
      await beli.receiveTarget(bot, chatId, userId, msg.text);
    } else if (state.action === 'topup:input_amount') {
      await topup.receiveAmount(bot, chatId, userId, msg.text, notifyAdmins);
    } else if (state.action === 'tools:operator') {
      await misc.receiveOperatorCheck(bot, chatId, userId, msg.text);
    }
  } catch (e) {
    logger.error('message handler error:', e.message);
    bot.sendMessage(chatId, '⚠️ Terjadi kesalahan. Coba lagi atau /start.').catch(() => {});
  }
});

// ===== Callback query (tombol inline) =====
bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id;
  const messageId = q.message.message_id;
  const data = q.data || '';
  const from = q.from;

  // ensure user
  const user = userService.ensureUser(from);
  if (user.banned) {
    return bot.answerCallbackQuery(q.id, { text: 'Akun kamu diblokir.', show_alert: true });
  }

  try {
    // ---- Menu utama ----
    if (data === 'menu:home') {
      clearState(from.id);
      await start.editToMainMenu(bot, chatId, messageId, from);
    } else if (data === 'menu:beli') {
      await beli.showCategories(bot, chatId, messageId);
    } else if (data === 'menu:topup') {
      await topup.showTopupMenu(bot, chatId, messageId, from.id);
    } else if (data === 'menu:riwayat') {
      await misc.showRiwayat(bot, chatId, messageId, from.id);
    } else if (data === 'menu:tools') {
      await misc.showTools(bot, chatId, messageId);
    } else if (data === 'menu:bantuan') {
      await misc.showBantuan(bot, chatId, messageId);
    } else if (data === 'menu:admin') {
      await admin.showAdminMenu(bot, chatId, messageId, from);

    // ---- Beli Paket ----
    } else if (data.startsWith('beli:cat:')) {
      await beli.showBrands(bot, chatId, messageId, data.slice('beli:cat:'.length));
    } else if (data.startsWith('beli:brand:')) {
      const rest = data.slice('beli:brand:'.length);
      const [catTok, brandTok] = rest.split(':');
      await beli.showProducts(bot, chatId, messageId, catTok, brandTok, from.id);
    } else if (data.startsWith('beli:prod:')) {
      await beli.selectProduct(bot, chatId, messageId, data.slice('beli:prod:'.length), from.id);
    } else if (data === 'beli:pay') {
      await beli.pay(bot, chatId, messageId, from.id, notifyAdmins);

    // ---- Top Up ----
    } else if (data === 'topup:new') {
      await topup.askAmount(bot, chatId, messageId, from.id);
    } else if (data.startsWith('tu:ok:')) {
      if (!isAdmin(from.id)) return bot.answerCallbackQuery(q.id, { text: 'Khusus admin.', show_alert: true });
      await topup.approve(bot, chatId, messageId, from, Number(data.slice('tu:ok:'.length)));
    } else if (data.startsWith('tu:no:')) {
      if (!isAdmin(from.id)) return bot.answerCallbackQuery(q.id, { text: 'Khusus admin.', show_alert: true });
      await topup.reject(bot, chatId, messageId, from, Number(data.slice('tu:no:'.length)));

    // ---- Tools ----
    } else if (data === 'tools:operator') {
      await misc.askOperator(bot, chatId, messageId, from.id);

    // ---- Admin ----
    } else if (data === 'adm:stats') {
      if (isAdmin(from.id)) await admin.showStats(bot, chatId, messageId);
    } else if (data === 'adm:topups') {
      if (isAdmin(from.id)) await admin.showPendingTopups(bot, chatId, messageId);
    } else if (data === 'adm:addsaldo') {
      if (isAdmin(from.id)) await admin.askAddSaldo(bot, chatId, messageId, from.id);
    } else if (data === 'adm:setrole') {
      if (isAdmin(from.id)) await admin.askSetRole(bot, chatId, messageId, from.id);
    } else if (data === 'adm:broadcast') {
      if (isAdmin(from.id)) await admin.askBroadcast(bot, chatId, messageId, from.id);
    } else if (data === 'adm:sync') {
      if (isAdmin(from.id)) await admin.syncProducts(bot, chatId, messageId);
    }
  } catch (e) {
    logger.error('callback error:', e.message);
  } finally {
    bot.answerCallbackQuery(q.id).catch(() => {});
  }
});

bot.on('polling_error', (e) => logger.warn('polling_error:', e.message));
bot.on('webhook_error', (e) => logger.warn('webhook_error:', e.message));

process.on('unhandledRejection', (e) => logger.error('unhandledRejection:', e));

logger.info(`${config.store.name} berjalan. Admin: ${config.adminIds.join(', ') || '-'}`);
