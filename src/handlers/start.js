'use strict';

const { config, isAdmin } = require('../config');
const { ensureUser, countUsers } = require('../services/userService');
const { countTransactions, todayRevenue } = require('../services/trxService');
const { mainMenu } = require('../keyboards/menus');
const { rupiah, escapeHtml, LINE } = require('../utils/format');
const { editOrSend } = require('../utils/ui');
const { one } = require('../db/database');

async function buildMenuText(user) {
  const [totalTrx, today, totalUsers, bannerRow] = await Promise.all([
    countTransactions(),
    todayRevenue(),
    countUsers(),
    one("SELECT value FROM settings WHERE key = 'banner_photo'"),
  ]);

  const bannerPhoto = bannerRow ? bannerRow.value : null;

  // blok data rata kolom (monospace) -> tampilan rapi & "premium"
  const akun =
    `Saldo : ${rupiah(user.balance)}\n` +
    `Role  : ${escapeHtml(user.role)}`;
  const stat =
    `Transaksi : ${totalTrx}\n` +
    `Hari ini  : ${rupiah(today)}\n` +
    `Pengguna  : ${totalUsers}`;

  const text = (
    `<b>${escapeHtml(config.store.name.toUpperCase())}</b>\n` +
    `${LINE}\n` +
    `Halo, <b>${escapeHtml(user.name)}</b> 👋\n\n` +
    `<code>${akun}</code>\n` +
    `${LINE}\n` +
    `<b>Statistik</b>\n` +
    `<code>${stat}</code>\n` +
    `${LINE}\n` +
    (config.store.maintenance && config.store.maintenance !== '-'
      ? `<i>Maintenance ${escapeHtml(config.store.maintenance)}</i>\n`
      : '') +
    `Silakan pilih menu di bawah.`
  );

  return { text, bannerPhoto };
}

async function sendMainMenu(bot, chatId, from) {
  const user = await ensureUser(from);
  const { text, bannerPhoto } = await buildMenuText(user);
  if (bannerPhoto) {
    return bot.sendPhoto(chatId, bannerPhoto, {
      caption: text,
      parse_mode: 'HTML',
      reply_markup: mainMenu(),
    });
  }
  return bot.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    reply_markup: mainMenu(),
  });
}

async function editToMainMenu(bot, chatId, messageId, from) {
  const user = await ensureUser(from);
  const { text } = await buildMenuText(user);
  // Selalu edit pesan yang sama supaya tetap 1 chat. Jika pesan saat ini berupa
  // foto (mis. banner /start), editOrSend otomatis menghapusnya lalu mengirim
  // satu pesan teks sebagai pengganti — tidak menumpuk chat baru.
  return editOrSend(bot, chatId, messageId, text, mainMenu());
}

module.exports = { sendMainMenu, editToMainMenu, buildMenuText };
