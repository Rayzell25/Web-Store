'use strict';

const { config } = require('../config');
const logger = require('../utils/logger');
const { query } = require('../db/database');
const trxService = require('./trxService');
const digiflazz = require('./digiflazz');
const userService = require('./userService');
const groupNotify = require('./groupNotify');
const { setTrxMsg, getTrxMsg, clearTrxMsg } = require('../utils/session');
const { rupiah, escapeHtml, LINE } = require('../utils/format');

let botRef = null;
let notifyRef = null;
let timer = null;
const inFlight = new Set();

/**
 * Poller rekonsiliasi status transaksi Digiflazz.
 *
 * Masalah yang diselesaikan: saat beli produk, Digiflazz sering balas "Pending"
 * (proses async). Saldo user sudah dipotong, tapi tanpa rekonsiliasi status
 * akhir, transaksi nyangkut "Pending" selamanya — kalau ternyata GAGAL, saldo
 * tidak balik. Poller ini cek berkala status final ke Digiflazz:
 *   - jadi Sukses -> update + kirim struk/SN ke user
 *   - jadi Gagal  -> update + REFUND saldo (atomik, anti dobel) + notif user
 *   - masih Pending tapi sudah lewat timeout -> dianggap Gagal & di-refund
 */
function start(bot, notifyAdmins) {
  botRef = bot;
  notifyRef = typeof notifyAdmins === 'function' ? notifyAdmins : () => {};

  if (!config.digiflazz.username || !config.digiflazz.apiKey) {
    logger.warn('Digiflazz belum dikonfigurasi — poller rekonsiliasi tidak dijalankan.');
    return;
  }
  const sec = Math.max(0, Number(config.digiflazz.reconcileSec) || 0);
  if (sec === 0) {
    logger.info('Poller rekonsiliasi Digiflazz nonaktif (DIGIFLAZZ_RECONCILE_SEC=0).');
    return;
  }
  if (timer) return;
  timer = setInterval(tick, sec * 1000);
  logger.info(`Poller rekonsiliasi Digiflazz jalan tiap ${sec}s.`);
}

async function tick() {
  let pending;
  try {
    pending = await trxService.pendingTransactions(90 * 1000, 30);
  } catch (e) {
    logger.error('reconcile pendingTransactions error:', e.message);
    return;
  }
  for (const trx of pending) {
    if (inFlight.has(trx.ref_id)) continue;
    processOne(trx).catch((e) => logger.error('reconcile processOne error:', e.message));
  }
}

async function processOne(trx) {
  const refId = trx.ref_id;
  if (inFlight.has(refId)) return;
  inFlight.add(refId);
  try {
    let result;
    try {
      result = await digiflazz.checkTransaction({
        buyerSkuCode: trx.buyer_sku_code,
        customerNo: trx.target,
        refId,
      });
    } catch (e) {
      // Gateway error sementara -> jangan ubah apa-apa, coba lagi tick berikutnya.
      logger.warn(`reconcile cek ${refId} gagal sementara:`, e.message);
      // Cek timeout: kalau sudah terlalu lama Pending, gagalkan & refund.
      await maybeTimeoutRefund(trx);
      return;
    }

    const status = digiflazz.mapStatus(result.status);
    const sn = result.sn || null;
    const message = result.message || '';

    if (status === 'Sukses') {
      await markSukses(trx, sn, message);
    } else if (status === 'Gagal') {
      await markGagalRefund(trx, message);
    } else {
      // masih Pending di Digiflazz -> cek timeout
      await maybeTimeoutRefund(trx);
    }
  } finally {
    inFlight.delete(refId);
  }
}

/** Klaim transisi status secara ATOMIK: hanya berhasil bila masih 'Pending'. */
async function claimFinalize(refId, newStatus, sn, message) {
  const r = await query(
    `UPDATE transactions
        SET status = $1, sn = $2, message = $3, updated_at = $4
      WHERE ref_id = $5 AND status = 'Pending'
      RETURNING *`,
    [newStatus, sn || null, message || null, Date.now(), refId]
  );
  return r.rows[0] || null; // null = sudah difinalkan proses lain (anti dobel)
}

async function markSukses(trx, sn, message) {
  const row = await claimFinalize(trx.ref_id, 'Sukses', sn, message);
  if (!row) return; // sudah ditangani
  const detail =
    `Produk : ${trx.product_name}\n` +
    `Tujuan : ${trx.target}\n` +
    `Harga  : ${rupiah(trx.sell_price)}\n` +
    (sn ? `SN     : ${sn}\n` : '') +
    `Ref    : ${trx.ref_id}`;
  await notifyUserTrx(trx.ref_id, trx.user_id,
    `<b>TRANSAKSI SUKSES</b> ✅\n${LINE}\n<code>${escapeHtml(detail)}</code>` +
    (message ? `\n${escapeHtml(message)}` : ''));
  notifyRef(`✅ (rekonsiliasi) ${trx.product_name} → ${trx.target} SUKSES. Ref: ${trx.ref_id}`);
  groupNotify.notifyTrx({ status: 'Sukses', productName: trx.product_name, target: trx.target, price: trx.sell_price, refId: trx.ref_id, sn, userId: trx.user_id });
}

async function markGagalRefund(trx, message) {
  // Finalkan ke 'Gagal' secara atomik DULU. Hanya pemenang yang me-refund.
  const row = await claimFinalize(trx.ref_id, 'Gagal', null, message || 'Gagal di provider');
  if (!row) return; // sudah difinalkan proses lain -> JANGAN refund lagi
  let newBal = null;
  try {
    newBal = await userService.addBalance(trx.user_id, trx.sell_price); // refund
  } catch (e) {
    logger.error(`reconcile refund ${trx.ref_id} gagal:`, e.message);
  }
  await notifyUserTrx(trx.ref_id, trx.user_id,
    `<b>TRANSAKSI GAGAL</b> ❌\n${LINE}\n` +
    `${escapeHtml(message || 'Transaksi gagal di provider.')}\n` +
    `Saldo <b>${rupiah(trx.sell_price)}</b> dikembalikan.` +
    (newBal != null ? `\nSaldo sekarang: ${rupiah(newBal)}` : '') +
    `\nRef: <code>${escapeHtml(trx.ref_id)}</code>`);
  notifyRef(`❌ (rekonsiliasi) ${trx.product_name} → ${trx.target} GAGAL, refund ${rupiah(trx.sell_price)}. Ref: ${trx.ref_id}`);
  groupNotify.notifyTrx({ status: 'Gagal', productName: trx.product_name, target: trx.target, price: trx.sell_price, refId: trx.ref_id, userId: trx.user_id });
}

/** Kalau transaksi Pending sudah lewat batas waktu, anggap gagal & refund. */
async function maybeTimeoutRefund(trx) {
  const timeoutMin = Number(config.digiflazz.reconcileTimeoutMin) || 0;
  if (timeoutMin <= 0) return;
  const age = Date.now() - Number(trx.created_at);
  if (age < timeoutMin * 60 * 1000) return;
  logger.warn(`reconcile ${trx.ref_id} timeout (${timeoutMin}m) -> gagalkan & refund`);
  await markGagalRefund(trx, `Tidak ada kepastian dari provider > ${timeoutMin} menit`);
}

function sendMessage(chatId, text) {
  if (!botRef) return Promise.resolve();
  return botRef.sendMessage(chatId, text, { parse_mode: 'HTML' }).catch(() => {});
}

/**
 * Kirim notif transaksi ke user. Kalau ada pesan "PENDING" (DM) yang tersimpan
 * untuk refId ini, EDIT pesan itu jadi status final supaya tidak menumpuk chat.
 * Kalau edit gagal / tak ada pesan tersimpan -> kirim pesan baru (fallback aman).
 */
async function notifyUserTrx(refId, userId, text) {
  if (!botRef) return;
  const prev = await getTrxMsg(refId, 'dm').catch(() => null);
  if (prev && prev.chatId && prev.messageId) {
    try {
      await botRef.editMessageText(text, {
        chat_id: prev.chatId, message_id: prev.messageId, parse_mode: 'HTML',
      });
      await clearTrxMsg(refId, 'dm').catch(() => {});
      return;
    } catch (e) {
      const m = String((e && e.message) || '').toLowerCase();
      if (m.includes('not modified')) { await clearTrxMsg(refId, 'dm').catch(() => {}); return; }
      // gagal edit (mis. pesan dihapus) -> fallback kirim baru
    }
  }
  await clearTrxMsg(refId, 'dm').catch(() => {});
  await sendMessage(userId, text);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * FAST-POLL: percepat finalisasi SATU transaksi yang baru dibuat.
 * Dipanggil fire-and-forget tepat setelah order dibuat & Digiflazz balas "Pending"
 * (prabayar diproses async). Cek status tiap `intervalMs` (default 3s) sampai
 * `attempts` kali; begitu Digiflazz kasih status final -> langsung difinalkan
 * (Sukses / Gagal+refund) lewat processOne() yang sama dengan poller berkala.
 *
 * Aman:
 *  - Pakai ulang processOne -> claimFinalize (UPDATE atomik WHERE status='Pending'),
 *    jadi TIDAK mungkin dobel-proses/dobel-refund walau tabrakan dgn tick 60s.
 *  - Berhenti begitu status bukan Pending lagi. Error apa pun ditelan (log warn).
 *  - Poller berkala (90s/60s) tetap jadi jaring pengaman bila fast-poll habis attempt.
 */
async function fastPoll(refId, opts = {}) {
  const { attempts = 15, intervalMs = 3000, initialDelayMs = 4000 } = opts;
  if (!botRef || !refId) return;
  if (!config.digiflazz.username || !config.digiflazz.apiKey) return;
  try {
    await sleep(initialDelayMs); // beri Digiflazz waktu memproses dulu
    for (let i = 0; i < attempts; i++) {
      let trx;
      try {
        trx = await trxService.getTransaction(refId);
      } catch (e) {
        logger.warn(`fastPoll get ${refId} error:`, e.message);
        return;
      }
      if (!trx || trx.status !== 'Pending') return; // sudah final -> selesai
      try {
        await processOne(trx);
      } catch (e) {
        logger.warn(`fastPoll processOne ${refId} error:`, e.message);
      }
      let after;
      try {
        after = await trxService.getTransaction(refId);
      } catch (e) {
        return;
      }
      if (!after || after.status !== 'Pending') return; // berhasil difinalkan
      await sleep(intervalMs);
    }
  } catch (e) {
    logger.warn(`fastPoll ${refId} error:`, e.message);
  }
}

module.exports = { start, processOne, fastPoll };
