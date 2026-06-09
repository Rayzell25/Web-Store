'use strict';

const TelegramBot = require('node-telegram-bot-api');
const { config, isAdmin, assertConfig } = require('./config');
const { init: initDb } = require('./db/database');
const { initRedis } = require('./cache/redis');
const logger = require('./utils/logger');
const { rupiah } = require('./utils/format');

const userService = require('./services/userService');
const markupService = require('./services/markupService');
const qrisPoller = require('./services/qrisPoller');
const digiflazzPoller = require('./services/digiflazzPoller');
const groupNotify = require('./services/groupNotify');
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
  await initDb();
  await markupService.load();
  await initRedis();

  const botOptions = { polling: true };
  if (config.telegram.apiRoot) {
    // Local Bot API server -> latency rendah saat klik tombol
    botOptions.baseApiUrl = config.telegram.apiRoot;
    logger.info(`Memakai Local Bot API: ${config.telegram.apiRoot}`);
  }

  const bot = new TelegramBot(config.botToken, botOptions);

  // Notif transaksi ke grup (private lengkap / public disensor). No-op bila ID kosong.
  groupNotify.init(bot);

  // ===== Bungkus SEMUA pesan teks HTML jadi expandable blockquote =====
  // (caption foto QR & popup alert tidak terpengaruh)
  function wrapHtml(text) {
    if (typeof text === 'string' && !text.startsWith('<blockquote')) {
      return `<blockquote>${text}</blockquote>`;
    }
    return text;
  }
  const _send = bot.sendMessage.bind(bot);
  bot.sendMessage = (chatId, text, opts = {}) => {
    if (opts && opts.parse_mode === 'HTML') text = wrapHtml(text);
    return _send(chatId, text, opts);
  };
  const _editText = bot.editMessageText.bind(bot);
  bot.editMessageText = (text, opts = {}) => {
    if (opts && opts.parse_mode === 'HTML') text = wrapHtml(text);
    return _editText(text, opts);
  };

  // ===== helper notifikasi admin =====
  function notifyAdmins(text, opts = {}) {
    for (const id of config.adminIds) {
      bot.sendMessage(id, text, { parse_mode: 'HTML', ...opts }).catch(() => {});
    }
  }

  // ===== helper broadcast =====
  async function broadcast(text) {
    const ids = await userService.allUserIds();
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
    // Hapus pesan perintah /start dari user supaya chat tetap bersih.
    bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    start.sendMainMenu(bot, msg.chat.id, msg.from).catch((e) => logger.error(e));
  });

  bot.onText(/^\/saldo\b/, async (msg) => {
    const u = await userService.ensureUser(msg.from);
    bot.sendMessage(msg.chat.id, `<b>Saldo kamu:</b> ${rupiah(u.balance)}`, { parse_mode: 'HTML' });
  });

  bot.onText(/^\/id\b/, (msg) => {
    bot.sendMessage(msg.chat.id, `<b>ID Telegram kamu:</b> <code>${msg.from.id}</code>`, { parse_mode: 'HTML' });
  });

  // panel admin khusus owner (tombol Admin di menu sudah dihapus)
  bot.onText(/^\/admin\b/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    await userService.ensureUser(msg.from);
    await admin.showAdminMenu(bot, msg.chat.id, null, msg.from);
  });

  // ===== Pesan teks (alur multi-langkah) =====
  bot.on('message', async (msg) => {
    // Admin kirim foto untuk banner /start
    if (msg.photo && msg.photo.length > 0 && isAdmin(msg.from.id)) {
      const userId = msg.from.id;
      const chatId = msg.chat.id;
      const state = await getState(userId);
      if (state && state.action === 'adm:set_foto') {
        await clearState(userId);
        const fileId = msg.photo[msg.photo.length - 1].file_id; // ambil resolusi tertinggi
        const { query } = require('./db/database');
        await query(
          "INSERT INTO settings (key, value) VALUES ('banner_photo', $1) ON CONFLICT (key) DO UPDATE SET value = $2",
          [fileId, fileId]
        );
        await bot.sendMessage(chatId, '<b>Foto sambutan berhasil disimpan!</b>\nKetik /start untuk lihat hasilnya.', { parse_mode: 'HTML' });
        return;
      }
    }

    if (!msg.text || msg.text.startsWith('/')) return;
    const userId = msg.from.id;
    const chatId = msg.chat.id;

    await userService.ensureUser(msg.from);

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
      } else if (state.action === 'tools:pulsa') {
        await tools.receivePulsa(bot, chatId, userId, msg.text, msg.message_id);
      } else if (state.action === 'tools:area') {
        await tools.receiveArea(bot, chatId, userId, msg.text, msg.message_id);
      }
    } catch (e) {
      logger.error('message handler error:', e.message);
      bot.sendMessage(chatId, '⚠️ Terjadi kesalahan. Coba lagi atau /start.', { parse_mode: 'HTML' }).catch(() => {});
    }
  });

  // ===== Callback query (router tombol) =====
  bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const messageId = q.message.message_id;
    const data = q.data || '';
    const from = q.from;

    // Jawab callback query SEKALI saja (guard) -> tombol responsif, popup tak dobel.
    let answered = false;
    const ack = (opts) => {
      if (answered) return Promise.resolve();
      answered = true;
      return bot.answerCallbackQuery(q.id, opts).catch(() => {});
    };
    // popup alert (tanpa kirim chat, tanpa nama bot)
    const alert = (text) => ack({ text, show_alert: true });

    const user = await userService.ensureUser(from);
    if (user.banned) {
      return ack({ text: 'Akun kamu diblokir.', show_alert: true });
    }

    // Tombol navigasi (mayoritas): JAWAB DULUAN biar animasi loading di tombol
    // langsung hilang (anti-"ngendat"). Tombol yang butuh popup teks/alert
    // (beli saldo, cek/batal QRIS, approve/reject admin) dibiarkan dijawab oleh
    // cabangnya sendiri lewat ack() supaya teks popup-nya tetap muncul.
    const needsPopup =
      data === 'order:pay:saldo' ||
      data.startsWith('qris:check:') ||
      data.startsWith('qris:cancel:') ||
      data.startsWith('dp:ok:') ||
      data.startsWith('dp:no:');
    if (!needsPopup) ack();

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
      } else if (data === 'order:pay:saldo') {
        await order.pay(bot, chatId, messageId, from.id, notifyAdmins, alert);
      } else if (data === 'order:pay:qris') {
        await order.payQris(bot, chatId, messageId, from.id);

      // ---- Cek Stok ----
      } else if (data.startsWith('stok:cat:')) {
        await stok.showBrands(bot, chatId, messageId, data.slice('stok:cat:'.length));
      } else if (data.startsWith('stok:brand:')) {
        const [catTok, brandTok] = data.slice('stok:brand:'.length).split(':');
        await stok.showList(bot, chatId, messageId, catTok, brandTok, from.id);

      // ---- Deposit / Top Up ----
      } else if (data === 'deposit:custom') {
        await deposit.askAmount(bot, chatId, messageId, from.id);
      } else if (data.startsWith('deposit:nom:')) {
        await deposit.chooseNominal(bot, chatId, messageId, from.id, data.slice('deposit:nom:'.length), notifyAdmins);
      } else if (data.startsWith('qris:check:')) {
        await qrisPoller.checkNow(data.slice('qris:check:'.length));
        ack({ text: 'Mengecek pembayaran...' });
      } else if (data.startsWith('qris:cancel:')) {
        const ok = await qrisPoller.cancel(data.slice('qris:cancel:'.length));
        ack({ text: ok ? 'Dibatalkan.' : 'Tidak bisa dibatalkan.' });
      } else if (data.startsWith('dp:ok:')) {
        if (!isAdmin(from.id)) return ack({ text: 'Khusus admin.', show_alert: true });
        await deposit.approve(bot, chatId, messageId, from, Number(data.slice('dp:ok:'.length)));
      } else if (data.startsWith('dp:no:')) {
        if (!isAdmin(from.id)) return ack({ text: 'Khusus admin.', show_alert: true });
        await deposit.reject(bot, chatId, messageId, from, Number(data.slice('dp:no:'.length)));

      // ---- Tools ----
      } else if (data === 'tools:pulsa') {
        await tools.askPulsa(bot, chatId, messageId, from.id);
      } else if (data === 'tools:area') {
        await tools.askArea(bot, chatId, messageId, from.id);

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
      } else if (data.startsWith('adm:mk:')) {
        if (isAdmin(from.id)) await admin.handleMarkupCallback(bot, chatId, messageId, from, data);
      } else if (data === 'adm:broadcast') {
        if (isAdmin(from.id)) await admin.askBroadcast(bot, chatId, messageId, from.id);
      } else if (data === 'adm:sync') {
        if (isAdmin(from.id)) await admin.syncProducts(bot, chatId, messageId);
      } else if (data === 'adm:setfoto') {
        if (isAdmin(from.id)) await admin.showSetFoto(bot, chatId, messageId, from.id);
      } else if (data === 'adm:delfoto') {
        if (isAdmin(from.id)) await admin.deleteFoto(bot, chatId, messageId);
      }
    } catch (e) {
      logger.error('callback error:', e.message);
    } finally {
      ack();
    }
  });

  bot.on('polling_error', (e) => logger.warn('polling_error:', e.message));
  bot.on('webhook_error', (e) => logger.warn('webhook_error:', e.message));

  // poller QRIS (AutoGoPay) untuk deteksi pembayaran otomatis
  qrisPoller.start(bot, notifyAdmins);

  // poller rekonsiliasi status transaksi Digiflazz (Pending -> Sukses/Gagal + auto-refund)
  digiflazzPoller.start(bot, notifyAdmins);

  logger.info(`${config.store.name} berjalan. Admin: ${config.adminIds.join(', ') || '-'}`);
}

process.on('unhandledRejection', (e) => logger.error('unhandledRejection:', e));

main().catch((e) => {
  logger.error('Gagal start bot:', e.message);
  process.exit(1);
});
