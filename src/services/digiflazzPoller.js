'use strict';

const { config } = require('../config');
const logger = require('../utils/logger');
const { query } = require('../db/database');
const trxService = require('./trxService');
const digiflazz = require('./digiflazz');
const userService = require('./userService');
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
  try {
    const detail =
      `Produk : ${trx.product_name}\n` +
      `Tujuan : ${trx.target}\n` +
      `Harga  : ${rupiah(trx.sell_price)}\n` +
      (sn ? `SN     : ${sn}\n` : '') +
      `Ref    : ${trx.ref_id}`;
    await sendMessage(trx.user_id,
      `<b>TRANSAKSI SUKSES</b> ✅\n${LINE}\n<code>${escapeHtml(detail)}</code>` +
      (message ? `\n${escapeHtml(message)}` : ''));
  } catch (e) { /* user mungkin blokir bot */ }
  notifyRef(`✅ (rekonsiliasi) ${trx.product_name} → ${trx.target} SUKSES. Ref: ${trx.ref_id}`);
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
  try {
    await sendMessage(trx.user_id,
      `<b>TRANSAKSI GAGAL</b> ❌\n${LINE}\n` +
      `${escapeHtml(message || 'Transaksi gagal di provider.')}\n` +
      `Saldo <b>${rupiah(trx.sell_price)}</b> dikembalikan.` +
      (newBal != null ? `\nSaldo sekarang: ${rupiah(newBal)}` : '') +
      `\nRef: <code>${escapeHtml(trx.ref_id)}</code>`);
  } catch (e) { /* ignore */ }
  notifyRef(`❌ (rekonsiliasi) ${trx.product_name} → ${trx.target} GAGAL, refund ${rupiah(trx.sell_price)}. Ref: ${trx.ref_id}`);
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

module.exports = { start, processOne };
