'use strict';

const crypto = require('crypto');
const axios = require('axios');
const { config } = require('../config');
const logger = require('../utils/logger');

const BASE_URL = 'https://api.digiflazz.com/v1';

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

/**
 * Signature Digiflazz = md5(username + apiKey + cmd)
 * - cmd "pricelist" untuk daftar harga
 * - cmd "depo" untuk cek saldo
 * - cmd = ref_id untuk transaksi
 */
function sign(cmd) {
  return md5(config.digiflazz.username + config.digiflazz.apiKey + cmd);
}

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

/** Ambil price-list untuk satu cmd ('prepaid' atau 'pasca'). */
async function fetchPriceList(cmd) {
  const body = {
    cmd,
    username: config.digiflazz.username,
    sign: sign('pricelist'),
  };
  const { data } = await http.post('/price-list', body);
  if (!data || !data.data) {
    throw new Error(`Respon price-list ${cmd} tidak valid dari Digiflazz`);
  }
  if (!Array.isArray(data.data)) {
    throw new Error(data.data.message || `Gagal mengambil price-list ${cmd}`);
  }
  return data.data;
}

/**
 * Ambil daftar harga produk PRABAYAR + PASCABAYAR.
 * Diambil BERURUTAN dengan jeda kecil (bukan paralel) supaya tidak menembak
 * 2 request price-list dalam waktu bersamaan -> mengurangi peluang kena
 * rate-limit Digiflazz ("limitasi pengecekan pricelist").
 */
async function priceList() {
  const prepaid = await fetchPriceList('prepaid');
  // jeda biar tidak burst 2 request beruntun
  await new Promise((r) => setTimeout(r, 1500));
  let pasca = [];
  try {
    pasca = await fetchPriceList('pasca');
  } catch (e) {
    // Akun belum aktifkan pascabayar / rate-limit pada call kedua -> jangan gagal total
    logger.warn('price-list pasca dilewati:', e.message);
  }
  logger.info(`price-list: ${prepaid.length} prepaid + ${pasca.length} pasca`);
  return [...prepaid, ...pasca];
}

/** Cek saldo deposit di Digiflazz */
async function checkDeposit() {
  const body = {
    cmd: 'deposit',
    username: config.digiflazz.username,
    sign: sign('depo'),
  };
  const { data } = await http.post('/cek-saldo', body);
  return data && data.data ? data.data.deposit : null;
}

/**
 * Lakukan transaksi top up / pembelian prepaid.
 * @returns objek data transaksi dari Digiflazz
 */
async function topUp({ buyerSkuCode, customerNo, refId, testing = false }) {
  const body = {
    username: config.digiflazz.username,
    buyer_sku_code: buyerSkuCode,
    customer_no: customerNo,
    ref_id: refId,
    sign: sign(refId),
  };
  if (testing) body.testing = true;

  const { data } = await http.post('/transaction', body);
  if (!data || !data.data) {
    throw new Error('Respon transaksi tidak valid dari Digiflazz');
  }
  return data.data;
}

/**
 * Cek status transaksi yang sudah dibuat (rekonsiliasi).
 * Digiflazz: kirim ulang ke /transaction dengan ref_id yang SAMA -> server
 * mengembalikan status terkini transaksi itu (tidak membuat transaksi baru).
 */
async function checkTransaction({ buyerSkuCode, customerNo, refId }) {
  const body = {
    username: config.digiflazz.username,
    buyer_sku_code: buyerSkuCode,
    customer_no: customerNo,
    ref_id: refId,
    sign: sign(refId),
  };
  const { data } = await http.post('/transaction', body);
  if (!data || !data.data) {
    throw new Error('Respon cek transaksi tidak valid dari Digiflazz');
  }
  return data.data;
}

/** Petakan status Digiflazz ke status internal */
function mapStatus(digiStatus) {
  const s = String(digiStatus || '').toLowerCase();
  if (s === 'sukses') return 'Sukses';
  if (s === 'gagal') return 'Gagal';
  return 'Pending';
}

/**
 * Deteksi respons "deposit/saldo DIGIFLAZZ (penjual) tidak cukup".
 * Ini kondisi di sisi PENJUAL (deposit kita habis), bukan kegagalan produk dan
 * BUKAN saldo pembeli. Digiflazz menolak transaksi ini -> harus diperlakukan
 * GAGAL + refund pembeli SEGERA, JANGAN dibiarkan 'Pending' (supaya saldo
 * pembeli tidak ketahan). Setelah deposit diisi, pembeli harus beli ulang.
 * Deteksi via pesan provider (utama) + rc '41' (umum dipakai Digiflazz).
 */
function isSaldoHabis(result) {
  if (!result) return false;
  const rc = String(result.rc == null ? '' : result.rc).trim();
  if (rc === '41') return true;
  const msg = String(result.message || '').toLowerCase().replace(/\s+/g, ' ');
  if (!msg.includes('saldo') && !msg.includes('deposit')) return false;
  return msg.includes('tidak cukup')
    || msg.includes('tdk cukup')
    || msg.includes('tidak mencukupi')
    || msg.includes('belum cukup')
    || msg.includes('kurang');
}

module.exports = { priceList, checkDeposit, topUp, checkTransaction, mapStatus, isSaldoHabis, sign };
