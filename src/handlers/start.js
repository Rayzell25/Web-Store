'use strict';

const { config, isAdmin } = require('../config');
const { ensureUser, countUsers } = require('../services/userService');
const { countTransactions, todayRevenue } = require('../services/trxService');
const { mainMenu } = require('../keyboards/menus');
const { rupiah, escapeHtml } = require('../utils/format');

function buildMenuText(user) {
  const totalTrx = countTransactions();
  const today = todayRevenue();
  const totalUsers = countUsers();

  return (
    `<b>MENU UTAMA</b> ✨\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `Halo, <b>${escapeHtml(user.name)}</b>!\n\n` +
    `Selamat datang di <b>${escapeHtml(config.store.name)}</b> !!!\n\n` +
    `🛠 Maintenance: ${escapeHtml(config.store.maintenance)}\n\n` +
    `Silakan pilih menu di bawah untuk melanjutkan.\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💳 <b>Saldo:</b> ${rupiah(user.balance)}\n` +
    `🎖 <b>Role:</b> ${escapeHtml(user.role)}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 <b>Statistik Bot:</b>\n` +
    `<i>Total TRX:</i> ${totalTrx}\n` +
    `<i>Transaksi Hari Ini:</i> ${rupiah(today)}\n` +
    `<i>Total Pengguna:</i> ${totalUsers}`
  );
}

async function sendMainMenu(bot, chatId, from) {
  const user = ensureUser(from);
  const text = buildMenuText(user);
  return bot.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    reply_markup: mainMenu(isAdmin(from.id)),
  });
}

async function editToMainMenu(bot, chatId, messageId, from) {
  const user = ensureUser(from);
  const text = buildMenuText(user);
  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML',
      reply_markup: mainMenu(isAdmin(from.id)),
    });
  } catch (e) {
    // fallback kirim baru jika edit gagal (mis. pesan terlalu lama)
    await sendMainMenu(bot, chatId, from);
  }
}

module.exports = { sendMainMenu, editToMainMenu, buildMenuText };
