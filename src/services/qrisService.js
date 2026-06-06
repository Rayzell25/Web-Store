'use strict';

const { one, all, query } = require('../db/database');

function now() {
  return Date.now();
}

/** Catat transaksi QRIS yang menunggu pembayaran. */
async function create(row) {
  await query(
    `INSERT INTO qris_payments
      (transaction_id, order_id, user_id, chat_id, message_id, purpose, base_amount, fee, amount, payload, status, created_at, updated_at, expiry_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$11,$12)`,
    [
      row.transaction_id,
      row.order_id || null,
      row.user_id,
      row.chat_id,
      row.message_id || null,
      row.purpose,
      row.base_amount,
      row.fee || 0,
      row.amount,
      row.payload ? JSON.stringify(row.payload) : null,
      now(),
      row.expiry_at || null,
    ]
  );
  return get(row.transaction_id);
}

function get(txId) {
  return one('SELECT * FROM qris_payments WHERE transaction_id = $1', [txId]);
}

async function setMessageId(txId, messageId) {
  await query(
    'UPDATE qris_payments SET message_id = $1, updated_at = $2 WHERE transaction_id = $3',
    [messageId, now(), txId]
  );
}

/** Daftar QRIS yang masih menunggu (untuk di-poll). */
function listPending() {
  return all("SELECT * FROM qris_payments WHERE status = 'pending' ORDER BY created_at ASC");
}

/**
 * Klaim sebuah transaksi untuk diproses (anti double-process).
 * Hanya berhasil jika statusnya masih 'pending'. Mengembalikan row bila sukses klaim.
 */
function claim(txId) {
  return one(
    "UPDATE qris_payments SET status = 'processing', updated_at = $2 WHERE transaction_id = $1 AND status = 'pending' RETURNING *",
    [txId, now()]
  );
}

async function setStatus(txId, status) {
  await query(
    'UPDATE qris_payments SET status = $1, updated_at = $2 WHERE transaction_id = $3',
    [status, now(), txId]
  );
}

module.exports = { create, get, setMessageId, listPending, claim, setStatus };
