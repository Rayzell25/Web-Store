'use strict';

const TelegramBot = require('node-telegram-bot-api');
const { config, isAdmin, assertConfig } = require('./config');
const { init: initDb } = require('./db/database');
const { initRedis } = require('./cache/redis');
const logger = require('./utils/logger');
const { rupiah } = require('./utils/format');

const userService = require('./services/userService');
const { getState, clearState } = require('./utils/session');

// ---- Handlers (router terpusat di file ini) ----
const start = require('./handlers/start');
const order = require('./handlers/order');
const deposit = require('./handlers/deposit');
const stok = require('./handlers/stok');
const riwayat = require('./handlers/riwayat');
const tools = require('./handlers/tools');
const help = require('./handlers/help');
const admin = require('./handlers/admin');

async function main() {
  assertConfig();
  initDb();
  await initRedis();

  const botOptions = { polling: true };
  if (config.telegram.apiRoot) {
    // Local Bot API server -> latency rendah saat klik tombol
    botOptions.baseApiUrl = config.telegram.apiRoot;
    logger.info(`Memakai Local Bot API: ${config.telegram.apiRoot}`);
  }

  const bot = new TelegramBot(config.botToken, botOptions);

  // ===== helper notifikasi admin =====
  function notifyAdmins(text, opts = {}) {
    for (const id of config.adminIds) {
      bot.sendMessage(id, text, { parse_mode: 'HTML', ...opts }).catch(() => {});
    }
  }

  // ===== helper broadcast =====
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
      await new Promise((r) => setTimeout(r, 40));
    }
    return { sent, failed };
  }

  // ===== Commands =====
  bot.onText(/^\/(start|menu)\b/, async (msg) => {
    await clearState(msg.from.id);
    start.sendMainMenu(bot, msg.chat.id, msg.from).catch((e) => logger.error(e));
  });

  bot.onText(/^\/saldo\b/, (msg) => {
    const u = userService.ensureUser(msg.from);
    bot.sendMessage(msg.chat.id, `💳 Saldo kamu: ${rupiah(u.balance)}`);
  });

  bot.onText(/^\/id\b/, (msg) => {
    bot.sendMessage(msg.chat.id, `🆔 ID Telegram kamu: <code>${msg.from.id}</code>`, { parse_mode: 'HTML' });
  });

  // ===== Pesan teks (alur multi-langkah) =====
  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const userId = msg.from.id;
    const chatId = msg.chat.id;

    userService.ensureUser(msg.from);

    // input admin lebih dulu
    try {
      const handled = await admin.handleAdminText(bot, chatId, msg.from, msg.text, broadcast);
      if (handled) return;
    } catch (e) {
      logger.error('admin text error:', e.message);
    }

    const state = await getState(userId);
    if (!state) return;

    try {
      if (state.action === 'order:input_target') {
        await order.receiveTarget(bot, chatId, userId, msg.text);
      } else if (state.action === 'deposit:input_amount') {
        await deposit.receiveAmount(bot, chatId, userId, msg.text, notifyAdmins);
      } else if (state.action === 'tools:operator') {
        await tools.receiveOperatorCheck(bot, chatId, userId, msg.text);
      }
    } catch (e) {
      logger.error('message handler error:', e.message);
      bot.sendMessage(chatId, '⚠️ Terjadi kesalahan. Coba lagi atau /start.').catch(() => {});
    }
  });

  // ===== Callback query (router tombol) =====
  bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const messageId = q.message.message_id;
    const data = q.data || '';
    const from = q.from;

    const user = userService.ensureUser(from);
    if (user.banned) {
      return bot.answerCallbackQuery(q.id, { text: 'Akun kamu diblokir.', show_alert: true });
    }

    try {
      // ---- Menu utama ----
      if (data === 'menu:home') {
        await clearState(from.id);
        await start.editToMainMenu(bot, chatId, messageId, from);
      } else if (data === 'menu:order') {
        await order.showCategories(bot, chatId, messageId);
      } else if (data === 'menu:deposit') {
        await deposit.showDepositMenu(bot, chatId, messageId, from.id);
      } else if (data === 'menu:stok') {
        await stok.showCategories(bot, chatId, messageId);
      } else if (data === 'menu:riwayat') {
        await riwayat.showRiwayat(bot, chatId, messageId, from.id);
      } else if (data === 'menu:tools') {
        await tools.showTools(bot, chatId, messageId);
      } else if (data === 'menu:bantuan') {
        await help.showBantuan(bot, chatId, messageId);
      } else if (data === 'menu:admin') {
        await admin.showAdminMenu(bot, chatId, messageId, from);

      // ---- Beli Paket (order) ----
      } else if (data.startsWith('order:cat:')) {
        await order.showBrands(bot, chatId, messageId, data.slice('order:cat:'.length));
      } else if (data.startsWith('order:brand:')) {
        const [catTok, brandTok] = data.slice('order:brand:'.length).split(':');
        await order.showProducts(bot, chatId, messageId, catTok, brandTok, from.id);
      } else if (data.startsWith('order:prod:')) {
        await order.selectProduct(bot, chatId, messageId, data.slice('order:prod:'.length), from.id);
      } else if (data === 'order:pay') {
        await order.pay(bot, chatId, messageId, from.id, notifyAdmins);

      // ---- Cek Stok ----
      } else if (data.startsWith('stok:cat:')) {
        await stok.showBrands(bot, chatId, messageId, data.slice('stok:cat:'.length));
      } else if (data.startsWith('stok:brand:')) {
        const [catTok, brandTok] = data.slice('stok:brand:'.length).split(':');
        await stok.showList(bot, chatId, messageId, catTok, brandTok, from.id);

      // ---- Deposit / Top Up ----
      } else if (data === 'deposit:new') {
        await deposit.askAmount(bot, chatId, messageId, from.id);
      } else if (data.startsWith('dp:ok:')) {
        if (!isAdmin(from.id)) return bot.answerCallbackQuery(q.id, { text: 'Khusus admin.', show_alert: true });
        await deposit.approve(bot, chatId, messageId, from, Number(data.slice('dp:ok:'.length)));
      } else if (data.startsWith('dp:no:')) {
        if (!isAdmin(from.id)) return bot.answerCallbackQuery(q.id, { text: 'Khusus admin.', show_alert: true });
        await deposit.reject(bot, chatId, messageId, from, Number(data.slice('dp:no:'.length)));

      // ---- Tools ----
      } else if (data === 'tools:operator') {
        await tools.askOperator(bot, chatId, messageId, from.id);

      // ---- Admin ----
      } else if (data === 'adm:stats') {
        if (isAdmin(from.id)) await admin.showStats(bot, chatId, messageId);
      } else if (data === 'adm:deposits') {
        if (isAdmin(from.id)) await admin.showPendingDeposits(bot, chatId, messageId);
      } else if (data === 'adm:addsaldo') {
        if (isAdmin(from.id)) await admin.askAddSaldo(bot, chatId, messageId, from.id);
      } else if (data === 'adm:setrole') {
        if (isAdmin(from.id)) await admin.askSetRole(bot, chatId, messageId, from.id);
      } else if (data === 'adm:markup') {
        if (isAdmin(from.id)) await admin.showMarkup(bot, chatId, messageId, from.id);
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

  logger.info(`${config.store.name} berjalan. Admin: ${config.adminIds.join(', ') || '-'}`);
}

process.on('unhandledRejection', (e) => logger.error('unhandledRejection:', e));

main().catch((e) => {
  logger.error('Gagal start bot:', e.message);
  process.exit(1);
});
