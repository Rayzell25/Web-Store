'use strict';

const { config, isAdmin } = require('../config');
const { ensureUser, countUsers } = require('../services/userService');
const { countTransactions, todayRevenue } = require('../services/trxService');
const { mainMenu } = require('../keyboards/menus');
const { rupiah, escapeHtml, LINE } = require('../utils/format');
const { editOrSend, safeSend, safeSendPhoto } = require('../utils/ui');
const { pe } = require('../utils/premoji');
const { one } = require('../db/database');
const { setLastMenu, getLastMenu, clearLastMenu } = require('../utils/session');

async function buildMenuText(user) {
  const [totalTrx, today, totalUsers, bannerRow] = await Promise.all([
    countTransactions(),
    todayRevenue(),
    countUsers(),
    one("SELECT value FROM settings WHERE key = 'banner_photo'"),
  ]);

  const bannerPhoto = bannerRow ? bannerRow.value : null;

  // Baris data: tiap baris diberi premium emoji di depan.
  // CATATAN: TIDAK boleh dibungkus <code> — premium emoji tidak render di
  // dalam blok code/pre, makanya pakai teks biasa + tag <tg-emoji>.
  const akun =
    `${pe('saldo')} Saldo : ${rupiah(user.balance)}\n` +
    `${pe('role')} Role : ${escapeHtml(user.role)}`;
  const stat =
    `${pe('transaksi')} Transaksi : ${totalTrx}\n` +
    `${pe('hariini')} Hari ini : ${rupiah(today)}\n` +
    `${pe('pengguna')} Pengguna : ${totalUsers}`;

  const text = (
    `<b>${escapeHtml(config.store.name.toUpperCase())}</b>\n` +
    `${LINE}\n` +
    `${pe('halo')} Halo, <b>${escapeHtml(user.name)}</b>\n\n` +
    `${akun}\n` +
    `${LINE}\n` +
    `${pe('statistik')} <b>Statistik</b>\n` +
    `${stat}\n` +
    `${LINE}\n` +
    (config.store.maintenance && config.store.maintenance !== '-'
      ? `${pe('maintenance')} <i>Maintenance ${escapeHtml(config.store.maintenance)}</i>\n`
      : '') +
    `Silakan pilih menu di bawah.`
  );

  return { text, bannerPhoto };
}

async function sendMainMenu(bot, chatId, from) {
  const user = await ensureUser(from);
  const { text, bannerPhoto } = await buildMenuText(user);

  // Opsi A: hapus menu lama (kalau ada & masih < 48 jam) sebelum kirim baru
  // supaya nggak numpuk tiap /start. Nggak perlu await — best-effort.
  const oldId = await getLastMenu(chatId).catch(() => null);
  if (oldId) bot.deleteMessage(chatId, oldId).catch(() => {});

  let sent;
  if (bannerPhoto) {
    sent = await safeSendPhoto(bot, chatId, bannerPhoto, {
      caption: text,
      parse_mode: 'HTML',
      reply_markup: mainMenu(),
    });
  } else {
    sent = await safeSend(bot, chatId, text, {
      parse_mode: 'HTML',
      reply_markup: mainMenu(),
    });
  }

  // Simpan id menu baru untuk dihapus saat /start berikutnya.
  if (sent && sent.message_id) {
    setLastMenu(chatId, sent.message_id).catch(() => {});
  }
  return sent;
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
