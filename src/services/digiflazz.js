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

/** Ambil daftar harga produk prepaid */
async function priceList() {
  const body = {
    cmd: config.digiflazz.mode || 'prepaid',
    username: config.digiflazz.username,
    sign: sign('pricelist'),
  };
  const { data } = await http.post('/price-list', body);
  if (!data || !data.data) {
    throw new Error('Respon price-list tidak valid dari Digiflazz');
  }
  if (!Array.isArray(data.data)) {
    // biasanya error: { data: { message: ... } }
    throw new Error(data.data.message || 'Gagal mengambil price-list');
  }
  return data.data;
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

/** Petakan status Digiflazz ke status internal */
function mapStatus(digiStatus) {
  const s = String(digiStatus || '').toLowerCase();
  if (s === 'sukses') return 'Sukses';
  if (s === 'gagal') return 'Gagal';
  return 'Pending';
}

module.exports = { priceList, checkDeposit, topUp, mapStatus, sign };
