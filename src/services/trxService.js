'use strict';

const { db } = require('../db/database');

function now() {
  return Date.now();
}

function createTransaction(data) {
  db.prepare(
    `INSERT INTO transactions
      (ref_id, user_id, buyer_sku_code, product_name, target, cost_price, sell_price, status, sn, message, created_at, updated_at)
     VALUES (@ref_id, @user_id, @buyer_sku_code, @product_name, @target, @cost_price, @sell_price, @status, @sn, @message, @created_at, @updated_at)`
  ).run({
    ref_id: data.ref_id,
    user_id: data.user_id,
    buyer_sku_code: data.buyer_sku_code,
    product_name: data.product_name,
    target: data.target,
    cost_price: data.cost_price || 0,
    sell_price: data.sell_price || 0,
    status: data.status || 'Pending',
    sn: data.sn || null,
    message: data.message || null,
    created_at: now(),
    updated_at: now(),
  });
  return getTransaction(data.ref_id);
}

function getTransaction(refId) {
  return db.prepare('SELECT * FROM transactions WHERE ref_id = ?').get(refId);
}

function updateTransaction(refId, fields) {
  const allowed = ['status', 'sn', 'message'];
  const sets = [];
  const vals = {};
  for (const k of allowed) {
    if (k in fields) {
      sets.push(`${k} = @${k}`);
      vals[k] = fields[k];
    }
  }
  if (!sets.length) return getTransaction(refId);
  vals.ref_id = refId;
  vals.updated_at = now();
  db.prepare(
    `UPDATE transactions SET ${sets.join(', ')}, updated_at = @updated_at WHERE ref_id = @ref_id`
  ).run(vals);
  return getTransaction(refId);
}

function getUserTransactions(userId, limit = 10) {
  return db
    .prepare(
      'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    )
    .all(Number(userId), limit);
}

function countTransactions() {
  return db.prepare('SELECT COUNT(*) AS c FROM transactions').get().c;
}

/** Total nilai jual transaksi sukses hari ini (mulai 00:00 Asia/Jakarta) */
function todayRevenue() {
  const start = startOfTodayJakarta();
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(sell_price), 0) AS total
         FROM transactions
        WHERE status = 'Sukses' AND created_at >= ?`
    )
    .get(start);
  return row.total;
}

function startOfTodayJakarta() {
  // WIB = UTC+7
  const nowMs = Date.now();
  const offset = 7 * 60 * 60 * 1000;
  const jakarta = new Date(nowMs + offset);
  jakarta.setUTCHours(0, 0, 0, 0);
  return jakarta.getTime() - offset;
}

module.exports = {
  createTransaction,
  getTransaction,
  updateTransaction,
  getUserTransactions,
  countTransactions,
  todayRevenue,
};
