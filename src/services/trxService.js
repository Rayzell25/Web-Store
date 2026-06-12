'use strict';

const { one, all, query } = require('../db/database');

function now() {
  return Date.now();
}

async function createTransaction(data) {
  await query(
    `INSERT INTO transactions
      (ref_id, user_id, buyer_sku_code, product_name, target, cost_price, sell_price, status, sn, message, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
    [
      data.ref_id,
      data.user_id,
      data.buyer_sku_code,
      data.product_name,
      data.target,
      data.cost_price || 0,
      data.sell_price || 0,
      data.status || 'Pending',
      data.sn || null,
      data.message || null,
      now(),
    ]
  );
  return getTransaction(data.ref_id);
}

function getTransaction(refId) {
  return one('SELECT * FROM transactions WHERE ref_id = $1', [refId]);
}

async function updateTransaction(refId, fields) {
  const allowed = ['status', 'sn', 'message'];
  const sets = [];
  const vals = [];
  let i = 1;
  for (const k of allowed) {
    if (k in fields) {
      sets.push(`${k} = $${i++}`);
      vals.push(fields[k]);
    }
  }
  if (!sets.length) return getTransaction(refId);
  sets.push(`updated_at = $${i++}`);
  vals.push(now());
  vals.push(refId);
  await query(
    `UPDATE transactions SET ${sets.join(', ')} WHERE ref_id = $${i}`,
    vals
  );
  return getTransaction(refId);
}

function getUserTransactions(userId, limit = 10) {
  return all(
    'SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [Number(userId), limit]
  );
}

/**
 * Ambil transaksi yang masih 'Pending' dan sudah berumur minimal `minAgeMs`
 * (default 90 detik) — supaya tidak menabrak transaksi yang baru saja dibuat
 * dan masih diproses sinkron. Dipakai poller rekonsiliasi Digiflazz.
 */
function pendingTransactions(minAgeMs = 90 * 1000, limit = 30) {
  const before = now() - minAgeMs;
  return all(
    "SELECT * FROM transactions WHERE status = 'Pending' AND created_at <= $1 ORDER BY created_at ASC LIMIT $2",
    [before, limit]
  );
}

async function countTransactions() {
  const r = await one('SELECT COUNT(*)::int AS c FROM transactions');
  return r.c;
}

/** Total nilai jual transaksi sukses hari ini (mulai 00:00 WIB). */
async function todayRevenue() {
  const start = startOfTodayJakarta();
  const r = await one(
    `SELECT COALESCE(SUM(sell_price), 0)::bigint AS total
       FROM transactions
      WHERE status = 'Sukses' AND created_at >= $1`,
    [start]
  );
  return Number(r.total);
}

function startOfTodayJakarta() {
  const offset = 7 * 60 * 60 * 1000; // WIB = UTC+7
  const jakarta = new Date(Date.now() + offset);
  jakarta.setUTCHours(0, 0, 0, 0);
  return jakarta.getTime() - offset;
}

/**
 * Anti DOBEL: cek transaksi DUPLIKAT untuk user+produk+nomor yang SAMA.
 * Tujuannya mencegah double-charge saat pembeli menekan tombol "beli"
 * berkali-kali. Memblokir bila ditemukan transaksi yang:
 *   - status 'Pending' (proses sedang berjalan) — tanpa batas waktu, ATAU
 *   - status 'Sukses' yang dibuat dalam `cooldownMs` terakhir (cooldown).
 * TIDAK memblokir bila transaksi sebelumnya 'Gagal' -> pembeli boleh coba lagi
 * (mis. setelah deposit Digiflazz habis lalu diisi ulang).
 * @returns {Promise<{ref_id:string,status:string,created_at:number}|null>}
 */
function findDuplicate(userId, sku, target, cooldownMs = 120 * 1000) {
  const since = now() - Math.max(0, Number(cooldownMs) || 0);
  return one(
    `SELECT ref_id, status, created_at FROM transactions
       WHERE user_id = $1 AND buyer_sku_code = $2 AND target = $3
         AND ( status = 'Pending'
               OR (status = 'Sukses' AND created_at >= $4) )
       ORDER BY created_at DESC
       LIMIT 1`,
    [Number(userId), sku, String(target), since]
  );
}

module.exports = {
  createTransaction,
  getTransaction,
  findDuplicate,
  updateTransaction,
  getUserTransactions,
  pendingTransactions,
  countTransactions,
  todayRevenue,
};
