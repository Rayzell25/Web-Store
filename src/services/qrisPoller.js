'use strict';

const { config } = require('../config');
const logger = require('../utils/logger');
const autogopay = require('./autogopay');
const qrisService = require('./qrisService');
const userService = require('./userService');
const trxService = require('./trxService');
const depositService = require('./depositService');
const digiflazz = require('./digiflazz');
const digiflazzPoller = require('./digiflazzPoller');
const groupNotify = require('./groupNotify');
const { rupiah, escapeHtml, trxCode, LINE } = require('../utils/format');

let botRef = null;
let notifyRef = null;
let timer = null;
const inFlight = new Set();

function start(bot, notifyAdmins) {
  botRef = bot;
  notifyRef = typeof notifyAdmins === 'function' ? notifyAdmins : () => {};
  if (!config.qris.enabled) {
    logger.warn('QRIS nonaktif (AUTOGOPAY_API_KEY kosong) — poller tidak dijalankan.');
    return;
  }
  if (timer) return;
  const interval = Math.max(2, config.qris.pollSec) * 1000;
  timer = setInterval(tick, interval);
  logger.info(`QRIS poller jalan tiap ${config.qris.pollSec}s.`);
}

async function tick() {
  let pending;
  try {
    pending = await qrisService.listPending();
  } catch (e) {
    logger.error('qris listPending error:', e.message);
    return;
  }
  for (const row of pending) {
    if (inFlight.has(row.transaction_id)) continue;
    processOne(row).catch((e) => logger.error('qris processOne error:', e.message));
  }
}

/** Cek 1 transaksi & proses bila perlu. Dipakai poller & tombol "Cek Sekarang". */
async function processOne(row) {
  const txId = row.transaction_id;
  if (inFlight.has(txId)) return;
  inFlight.add(txId);
  try {
    // kedaluwarsa lokal
    if (row.expiry_at && Date.now() > Number(row.expiry_at)) {
      const claimed = await qrisService.claim(txId);
      if (claimed) {
        await qrisService.setStatus(txId, 'expired');
        await autogopay.cancelQris(txId);
        await markExpired(row);
      }
      return;
    }

    let status;
    try {
      status = await autogopay.checkStatus(txId);
    } catch (e) {
      return; // gateway error sementara, coba lagi tick berikutnya
    }

    if (status === 'settlement') {
      const claimed = await qrisService.claim(txId);
      if (claimed) await fulfill(row);
    } else if (status === 'expire' || status === 'cancel') {
      const claimed = await qrisService.claim(txId);
      if (claimed) {
        await qrisService.setStatus(txId, status === 'expire' ? 'expired' : 'canceled');
        await markExpired(row, status === 'cancel' ? 'Dibatalkan' : 'Kedaluwarsa');
      }
    }
  } finally {
    inFlight.delete(txId);
  }
}

/** Dipanggil tombol "Cek Sekarang". */
async function checkNow(txId) {
  const row = await qrisService.get(txId);
  if (row && row.status === 'pending') await processOne(row);
}

/** Dipanggil tombol "Batal". */
async function cancel(txId) {
  const claimed = await qrisService.claim(txId);
  if (!claimed) return false;
  await autogopay.cancelQris(txId);
  await qrisService.setStatus(txId, 'canceled');
  await markExpired(claimed, 'Dibatalkan');
  return true;
}

async function fulfill(row) {
  const payload = row.payload ? JSON.parse(row.payload) : {};
  if (row.purpose === 'topup') {
    await fulfillTopup(row);
  } else if (row.purpose === 'order') {
    await fulfillOrder(row, payload);
  }
  await qrisService.setStatus(row.transaction_id, 'done');
}

async function fulfillTopup(row) {
  const newBal = await userService.addBalance(row.user_id, row.base_amount);
  // Catat ke tabel topups (Approved) supaya muncul di riwayat. Dibungkus try/catch
  // agar kegagalan pencatatan TIDAK mengganggu saldo yang sudah masuk.
  try {
    await depositService.recordTopup(row.user_id, row.base_amount, 'Approved', 'QRIS otomatis');
  } catch (e) {
    logger.error('recordTopup (qris) error:', e.message);
  }
  const detail =
    `Nominal : ${rupiah(row.base_amount)}\n` +
    `Saldo   : ${rupiah(newBal)}`;
  await editCaption(row,
    `<b>TOP UP SUKSES</b>\n${LINE}\n<code>${escapeHtml(detail)}</code>\n\n<i>pesan ini hilang dalam ${config.qris.successTtlSec} detik</i>`);
  scheduleDelete(row);
}

async function fulfillOrder(row, payload) {
  const refId = trxCode('RAYZELL-');
  await trxService.createTransaction({
    ref_id: refId,
    user_id: row.user_id,
    buyer_sku_code: payload.sku,
    product_name: payload.product_name,
    target: payload.target,
    cost_price: payload.cost_price || 0,
    sell_price: row.base_amount,
    status: 'Pending',
  });

  await editCaption(row, `<b>PEMBAYARAN DITERIMA — MEMPROSES</b>\nRef: <code>${refId}</code>`);

  let result;
  try {
    result = await digiflazz.topUp({
      buyerSkuCode: payload.sku,
      customerNo: payload.target,
      refId,
    });
  } catch (e) {
    logger.error('Digiflazz (qris order) error:', e.message);
    await refundOrder(row, refId, 'Gagal menghubungi provider');
    return;
  }

  const status = digiflazz.mapStatus(result.status);
  const sn = result.sn || null;
  const message = result.message || '';

  if (status === 'Gagal') {
    await trxService.updateTransaction(refId, { status: 'Gagal', message, sn });
    await refundOrder(row, refId, message);
    return;
  }

  await trxService.updateTransaction(refId, { status, message, sn });

  // QR jadi info "diterima", struk dikirim sebagai pesan terpisah (permanen)
  await editCaption(row, `<b>PEMBAYARAN DITERIMA</b> ✅\nRef: <code>${refId}</code>`);
  scheduleDelete(row);

  const detail =
    `Produk : ${payload.product_name}\n` +
    `Tujuan : ${payload.target}\n` +
    `Harga  : ${rupiah(row.amount)}\n` +
    (sn ? `SN     : ${sn}\n` : '') +
    `Ref    : ${refId}`;
  await sendMessage(row.chat_id,
    `<b>TRANSAKSI ${status.toUpperCase()}</b>\n${LINE}\n<code>${escapeHtml(detail)}</code>` +
    (message ? `\n${escapeHtml(message)}` : ''));

  notifyRef(
    `QRIS Transaksi ${status}\nUser: ${row.user_id}\n${payload.product_name} -> ${payload.target}\nBayar: ${rupiah(row.amount)} | Ref: ${refId}`
  );
  groupNotify.notifyTrx({ status, productName: payload.product_name, target: payload.target, price: row.amount, refId, sn, userId: row.user_id });

  // Percepat finalisasi bila Digiflazz masih "Pending" (sama seperti order saldo).
  if (status === 'Pending') digiflazzPoller.fastPoll(refId);
}

/** Produk gagal walau QRIS sudah lunas -> kreditkan harga produk ke SALDO member. */
async function refundOrder(row, refId, reason) {
  const newBal = await userService.addBalance(row.user_id, row.base_amount);
  await editCaption(row,
    `<b>TRANSAKSI GAGAL</b> ❌\n${LINE}\n${escapeHtml(reason || '')}\nDana <b>${rupiah(row.base_amount)}</b> dimasukkan ke SALDO kamu.\nSaldo sekarang: ${rupiah(newBal)}\nRef: <code>${refId}</code>`);
  scheduleDelete(row);
  notifyRef(
    `QRIS lunas tapi produk GAGAL.\nUser: ${row.user_id} | Ref: ${refId}\nDikreditkan ke saldo: ${rupiah(row.base_amount)}`
  );
  try {
    const p = row.payload ? JSON.parse(row.payload) : {};
    groupNotify.notifyTrx({ status: 'Gagal', productName: p.product_name || '-', target: p.target || '-', price: row.base_amount, refId, userId: row.user_id });
  } catch (e) { /* ignore */ }
}

async function markExpired(row, label = 'Kedaluwarsa') {
  await editCaption(row, `<b>QRIS ${label.toUpperCase()}</b>\nPembayaran tidak diselesaikan. Ulangi dari menu.`);
  scheduleDelete(row);
}

// ===== helper Telegram =====
async function editCaption(row, caption) {
  if (!botRef || !row.message_id) return;
  try {
    await botRef.editMessageCaption(caption, {
      chat_id: row.chat_id,
      message_id: row.message_id,
      parse_mode: 'HTML',
    });
  } catch (e) {
    // mungkin pesan bukan foto / sudah dihapus -> kirim teks biasa
    try {
      await botRef.sendMessage(row.chat_id, caption, { parse_mode: 'HTML' });
    } catch (e2) { /* ignore */ }
  }
}

function sendMessage(chatId, text) {
  if (!botRef) return Promise.resolve();
  return botRef.sendMessage(chatId, text, { parse_mode: 'HTML' }).catch(() => {});
}

function scheduleDelete(row) {
  if (!botRef || !row.message_id) return;
  setTimeout(() => {
    botRef.deleteMessage(row.chat_id, row.message_id).catch(() => {});
  }, Math.max(1, config.qris.successTtlSec) * 1000);
}

module.exports = { start, checkNow, cancel, processOne };
