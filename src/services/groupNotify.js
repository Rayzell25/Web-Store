'use strict';

// Notifikasi transaksi ke GRUP Telegram:
//   - Grup PRIVATE (TRX_GROUP_PRIVATE_ID): detail LENGKAP untuk monitoring admin.
//   - Grup PUBLIC  (TRX_GROUP_PUBLIC_ID) : versi DISENSOR (nomor tujuan dimask),
//     hanya transaksi SUKSES, sebagai bukti/social-proof.
//
// Aman: fire-and-forget. Kalau ID grup belum diisi di .env, fungsi jadi no-op.
// Semua error ditelan (di-log warn) supaya TIDAK pernah mengganggu alur transaksi.

const { config } = require('../config');
const logger = require('../utils/logger');
const { rupiah, escapeHtml, tanggal, LINE } = require('../utils/format');
const { setTrxMsg, getTrxMsg, clearTrxMsg } = require('../utils/session');

let botRef = null;

function init(bot) {
  botRef = bot;
}

/** Sensor nomor/ID tujuan: tampilkan sebagian depan & belakang, sisanya bintang. */
function maskTarget(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return '-';
  if (s.length <= 4) return s[0] + '*'.repeat(Math.max(1, s.length - 1));
  const head = s.slice(0, 3);
  const tail = s.slice(-3);
  const stars = '*'.repeat(Math.max(3, s.length - 6));
  return `${head}${stars}${tail}`;
}

/** Kirim pesan; kembalikan message_id bila sukses, null bila gagal. */
async function send(chatId, text) {
  if (!botRef || !chatId) return null;
  try {
    const m = await botRef.sendMessage(chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
    return m && m.message_id ? m.message_id : null;
  } catch (e) {
    logger.warn('groupNotify gagal kirim:', e && e.message);
    return null;
  }
}

/** Edit pesan; true bila berhasil (atau "not modified"). */
async function edit(chatId, messageId, text) {
  if (!botRef || !chatId || !messageId) return false;
  try {
    await botRef.editMessageText(text, {
      chat_id: chatId, message_id: messageId,
      parse_mode: 'HTML', disable_web_page_preview: true,
    });
    return true;
  } catch (e) {
    return String((e && e.message) || '').toLowerCase().includes('not modified');
  }
}

/**
 * Kirim/Update notif transaksi ke grup.
 * @param {object} info { status, productName, target, price, refId, sn, userName, userId }
 *
 * Grup PRIVATE: pesan PENDING disimpan (per refId) lalu DI-EDIT saat final
 * (Sukses/Gagal) -> tidak menumpuk. Grup PUBLIC: hanya 1 pesan saat SUKSES.
 */
async function notifyTrx(info = {}) {
  try {
    const {
      status = 'Sukses',
      productName = '-',
      target = '-',
      price = 0,
      refId = '-',
      sn = null,
      userName = null,
      userId = null,
    } = info;

    const icon = status === 'Sukses' ? '✅' : status === 'Gagal' ? '❌' : '⏳';
    const isFinal = status === 'Sukses' || status === 'Gagal';
    const groups = config.groups || {};

    // ---- Grup PRIVATE: lengkap, 1 pesan yang di-edit dari Pending -> final ----
    if (groups.privateId) {
      const detail =
        `Produk : ${productName}\n` +
        `Tujuan : ${target}\n` +
        `Harga  : ${rupiah(price)}\n` +
        (sn ? `SN     : ${sn}\n` : '') +
        `Ref    : ${refId}\n` +
        (userName || userId
          ? `User   : ${userName || '-'}${userId ? ' (' + userId + ')' : ''}\n`
          : '') +
        `Waktu  : ${tanggal(Date.now())}`;
      const text = `<b>TRANSAKSI ${String(status).toUpperCase()}</b> ${icon}\n${LINE}\n<code>${escapeHtml(detail)}</code>`;

      const prev = await getTrxMsg(refId, 'group').catch(() => null);
      if (prev && prev.messageId) {
        const ok = await edit(prev.chatId, prev.messageId, text);
        if (!ok) await send(groups.privateId, text); // fallback kirim baru
      } else {
        const mid = await send(groups.privateId, text);
        if (mid && !isFinal) await setTrxMsg(refId, 'group', groups.privateId, mid).catch(() => {});
      }
      if (isFinal) await clearTrxMsg(refId, 'group').catch(() => {});
    }

    // ---- Grup PUBLIC: disensor, hanya yang SUKSES (1 pesan) ----
    if (groups.publicId && status === 'Sukses') {
      const detail =
        `Produk : ${productName}\n` +
        `Tujuan : ${maskTarget(target)}\n` +
        `Harga  : ${rupiah(price)}\n` +
        `Waktu  : ${tanggal(Date.now())}`;
      await send(
        groups.publicId,
        `<b>TRANSAKSI BERHASIL</b> ${icon}\n${LINE}\n<code>${escapeHtml(detail)}</code>\n\n` +
        `Terima kasih sudah order di <b>${escapeHtml(config.store.name)}</b>! 🙌`
      );
    }
  } catch (e) {
    logger.warn('groupNotify.notifyTrx error:', e && e.message);
  }
}

module.exports = { init, notifyTrx, maskTarget };
