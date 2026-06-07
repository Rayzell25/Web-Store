'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { all, one, init } = require('../db/database');
const markupService = require('../services/markupService');
const { sellPrice } = require('../services/productService');
const userService = require('../services/userService');
const trxService = require('../services/trxService');
const depositService = require('../services/depositService');
const digiflazz = require('../services/digiflazz');
const { rupiah, tanggal } = require('../utils/format');
const logger = require('../utils/logger');

const PORT = Number(process.env.WEB_PORT || 3000);
const STORE_NAME = process.env.STORE_NAME || 'Rayzell Store PPOB';

// kredensial admin web (dari .env)
const WEB_ADMIN_USER = process.env.WEB_ADMIN_USER || 'admin';
const WEB_ADMIN_PASS = process.env.WEB_ADMIN_PASSWORD || 'admin123';

// token sederhana in-memory (cukup untuk 1 admin)
const tokens = new Set();
function genToken() {
  const t = crypto.randomBytes(32).toString('hex');
  tokens.add(t);
  setTimeout(() => tokens.delete(t), 8 * 60 * 60 * 1000); // 8 jam
  return t;
}
function verifyToken(t) { return tokens.has(t); }

function waNumber() {
  let n = String(process.env.CONTACT_WA || '6287826532525').replace(/[^\d]/g, '');
  if (n.startsWith('0')) n = '62' + n.slice(1);
  return n;
}
const CONTACT = {
  waLink: `https://wa.me/${waNumber()}`,
  tgLink: process.env.CONTACT_TG || 'https://t.me/Rayzell23',
  botLink: process.env.BOT_USERNAME
    ? `https://t.me/${String(process.env.BOT_USERNAME).replace(/^@/, '')}`
    : (process.env.CONTACT_TG || 'https://t.me/Rayzell23'),
};

function maskTarget(t) {
  const s = String(t || '');
  if (s.length <= 5) return s;
  return s.slice(0, 3) + '****' + s.slice(-2);
}

// middleware cek token admin
function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || '';
  const t = auth.replace(/^Bearer\s+/i, '').trim();
  if (!verifyToken(t)) return res.status(401).json({ ok: false, message: 'Unauthorized' });
  next();
}

const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===================== PUBLIC API =====================

// etalase per kategori
app.get('/api/products', async (req, res) => {
  try {
    const rows = await all(
      `SELECT category, COUNT(*)::int AS count, MIN(price)::bigint AS minprice
         FROM products WHERE status = 'active'
        GROUP BY category ORDER BY category`
    );
    const data = rows.map((r) => {
      const harga = sellPrice(
        { price: Number(r.minprice), category: r.category, buyer_sku_code: '' },
        'MEMBER'
      );
      return { category: r.category, count: r.count, startFrom: harga, startFromText: rupiah(harga) };
    });
    res.json({ ok: true, data });
  } catch (e) {
    logger.error('web /api/products:', e.message);
    res.json({ ok: false, data: [] });
  }
});

// cek transaksi by ref_id
app.get('/api/trx/:refId', async (req, res) => {
  try {
    const refId = String(req.params.refId || '').trim().slice(0, 64);
    if (!refId) return res.json({ ok: false, message: 'Ref ID kosong' });
    const t = await one(
      'SELECT ref_id, product_name, target, status, created_at FROM transactions WHERE ref_id = $1',
      [refId]
    );
    if (!t) return res.json({ ok: false, message: 'Transaksi tidak ditemukan' });
    res.json({
      ok: true,
      data: {
        ref_id: t.ref_id,
        product: t.product_name,
        target: maskTarget(t.target),
        status: t.status,
        waktu: tanggal(Number(t.created_at)),
      },
    });
  } catch (e) {
    logger.error('web /api/trx:', e.message);
    res.json({ ok: false, message: 'Terjadi kesalahan' });
  }
});

// info kontak & nama toko
app.get('/api/info', (req, res) => {
  res.json({ ok: true, data: { store: STORE_NAME, ...CONTACT } });
});

app.get('/health', (req, res) => res.json({ ok: true }));

// ===================== ADMIN API =====================

// login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === WEB_ADMIN_USER && password === WEB_ADMIN_PASS) {
    return res.json({ ok: true, token: genToken() });
  }
  res.status(401).json({ ok: false, message: 'Username atau password salah.' });
});

// statistik
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const [users, transactions, todayRevenue] = await Promise.all([
      userService.countUsers(),
      trxService.countTransactions(),
      trxService.todayRevenue(),
    ]);
    let digiDeposit = null;
    try { digiDeposit = await digiflazz.checkDeposit(); } catch (e) { /* optional */ }
    res.json({ ok: true, data: { users, transactions, todayRevenue, digiDeposit } });
  } catch (e) {
    logger.error('web /api/admin/stats:', e.message);
    res.json({ ok: false, message: e.message });
  }
});

// transaksi terbaru
app.get('/api/admin/transactions', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 20), 100);
    const rows = await all(
      'SELECT ref_id, product_name, target, sell_price, status, created_at FROM transactions ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    res.json({
      ok: true,
      data: rows.map((r) => ({
        ref_id: r.ref_id,
        product_name: r.product_name,
        target: r.target,
        sell_price: r.sell_price,
        status: r.status,
        waktu: tanggal(Number(r.created_at)),
      })),
    });
  } catch (e) {
    logger.error('web /api/admin/transactions:', e.message);
    res.json({ ok: false, message: e.message });
  }
});

// top up pending
app.get('/api/admin/topups/pending', requireAdmin, async (req, res) => {
  try {
    const rows = await depositService.pendingDeposits(50);
    const data = await Promise.all(
      rows.map(async (d) => {
        const u = await userService.getUser(d.user_id);
        return {
          id: d.id,
          user_id: d.user_id,
          user_name: u ? u.name : String(d.user_id),
          amount: d.amount,
          waktu: tanggal(Number(d.created_at)),
        };
      })
    );
    res.json({ ok: true, data });
  } catch (e) {
    logger.error('web /api/admin/topups/pending:', e.message);
    res.json({ ok: false, message: e.message });
  }
});

// approve top up
app.post('/api/admin/topups/:id/approve', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const deposit = await depositService.getDeposit(id);
    if (!deposit) return res.json({ ok: false, message: 'Deposit tidak ditemukan.' });
    if (deposit.status !== 'Pending') return res.json({ ok: false, message: `Deposit sudah ${deposit.status}.` });
    await userService.addBalance(deposit.user_id, deposit.amount);
    await depositService.setDepositStatus(id, 'Approved', 'via web admin');
    const user = await userService.getUser(deposit.user_id);
    res.json({ ok: true, message: `Disetujui. Saldo ${user ? user.name : deposit.user_id} +${rupiah(deposit.amount)}.` });
  } catch (e) {
    logger.error('web approve topup:', e.message);
    res.json({ ok: false, message: e.message });
  }
});

// reject top up
app.post('/api/admin/topups/:id/reject', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const deposit = await depositService.getDeposit(id);
    if (!deposit) return res.json({ ok: false, message: 'Deposit tidak ditemukan.' });
    if (deposit.status !== 'Pending') return res.json({ ok: false, message: `Deposit sudah ${deposit.status}.` });
    await depositService.setDepositStatus(id, 'Rejected', 'via web admin');
    res.json({ ok: true, message: `Top up #${id} ditolak.` });
  } catch (e) {
    logger.error('web reject topup:', e.message);
    res.json({ ok: false, message: e.message });
  }
});

async function startWeb() {
  await init();
  await markupService.load();
  app.listen(PORT, '127.0.0.1', () => {
    logger.info(`Web storefront jalan di http://127.0.0.1:${PORT}`);
  });
}

startWeb().catch((e) => {
  logger.error('Gagal start web:', e.message);
  process.exit(1);
});
