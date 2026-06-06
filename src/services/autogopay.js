'use strict';

const axios = require('axios');
const { config } = require('../config');

const http = axios.create({
  baseURL: config.qris.baseUrl,
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
});

function authHeader() {
  return { Authorization: `Bearer ${config.qris.apiKey}` };
}

/** Hitung fee + total yang harus dibayar member untuk sebuah base amount. */
function computeTotal(baseAmount) {
  const base = Math.round(Number(baseAmount) || 0);
  let fee =
    config.qris.feeType === 'percent'
      ? (base * config.qris.feeValue) / 100
      : config.qris.feeValue;
  let total = base + fee;
  const round = config.qris.feeRound;
  if (round && round > 0) {
    total = Math.ceil(total / round) * round;
    fee = total - base; // fee ikut menyesuaikan pembulatan
  } else {
    total = Math.round(total);
    fee = Math.round(fee);
  }
  return { base, fee: Math.round(fee), total: Math.round(total) };
}

/** Generate QRIS baru. amount = total yang dibayar member (sudah termasuk fee). */
async function generateQris(amount) {
  const { data } = await http.post(
    '/qris/generate',
    { amount: Math.round(amount) },
    { headers: authHeader() }
  );
  if (!data || !data.success || !data.data) {
    throw new Error((data && data.message) || 'Gagal generate QRIS');
  }
  return data.data; // { transaction_id, order_id, amount, qr_string, qr_url, checkout_url, expiry_time, ... }
}

/** Cek status transaksi: pending | settlement | expire | cancel. */
async function checkStatus(transactionId) {
  const { data } = await http.post(
    '/qris/status',
    { transaction_id: transactionId },
    { headers: authHeader() }
  );
  if (!data || !data.success) {
    throw new Error((data && data.message) || 'Gagal cek status QRIS');
  }
  // status bisa di data.data.transaction_status atau data.data.status
  const d = data.data || {};
  return String(d.transaction_status || d.status || '').toLowerCase();
}

/** Batalkan transaksi QRIS yang masih pending. */
async function cancelQris(transactionId) {
  try {
    await http.post(
      '/qris/cancel',
      { transaction_id: transactionId },
      { headers: authHeader() }
    );
  } catch (e) {
    /* abaikan; pembatalan best-effort */
  }
}

module.exports = { computeTotal, generateQris, checkStatus, cancelQris, parseExpiry };

/** Parse "YYYY-MM-DD HH:MM:SS" (WIB) -> epoch ms. Fallback now + 15 menit. */
function parseExpiry(str) {
  if (str) {
    const ms = Date.parse(String(str).replace(' ', 'T') + '+07:00');
    if (Number.isFinite(ms)) return ms;
  }
  return Date.now() + 15 * 60 * 1000;
}
