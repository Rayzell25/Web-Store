'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { all, one, init } = require('../db/database');
const { config } = require('../config');
const markupService = require('../services/markupService');
const productService = require('../services/productService');
const { sellPrice } = require('../services/productService');
const userService = require('../services/userService');
const trxService = require('../services/trxService');
const depositService = require('../services/depositService');
const digiflazz = require('../services/digiflazz');
const autogopay = require('../services/autogopay');
const qrisService = require('../services/qrisService');
const { rupiah, tanggal, trxCode } = require('../utils/format');
const logger = require('../utils/logger');

const PORT = Number(process.env.WEB_PORT || 3000);
const STORE_NAME = process.env.STORE_NAME || 'Rayzell Store PPOB';

// kredensial admin web (dari .env)
const WEB_ADMIN_USER = process.env.WEB_ADMIN_USER || 'admin';
const WEB_ADMIN_PASS = process.env.WEB_ADMIN_PASSWORD || 'admin123';

// Rate-limit login admin: max 10 percobaan per IP per 15 menit (anti brute-force).
const loginAttempts = new Map(); // ip -> { count, resetAt }
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
function checkLoginRate(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  if (entry.count > LOGIN_LIMIT) return false;
  return true;
}
// Warn sekali saat start kalau password masih default.
if (WEB_ADMIN_PASS === 'admin123') {
  // eslint-disable-next-line no-console
  console.warn('[SECURITY] WEB_ADMIN_PASSWORD masih default "admin123" — ganti di .env!');
}

// token sederhana in-memory (cukup untuk 1 admin)
const tokens = new Set();
function genToken() {
  const t = crypto.randomBytes(32).toString('hex');
  tokens.add(t);
  setTimeout(() => tokens.delete(t), 8 * 60 * 60 * 1000); // 8 jam
  return t;
}
function verifyToken(t) { return tokens.has(t); }

// ===== Login member via Telegram Login Widget =====
// Verifikasi data login Telegram secara server-side (anti-palsu).
function verifyTelegramAuth(data) {
  const botToken = process.env.BOT_TOKEN || '';
  if (!botToken || !data || !data.hash) return false;
  const { hash, ...fields } = data;
  const checkString = Object.keys(fields).sort()
    .map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = crypto.createHash('sha256').update(botToken).digest();
  const hmac = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
  if (hmac !== hash) return false;
  const authDate = Number(fields.auth_date || 0);
  if (Date.now() / 1000 - authDate > 86400) return false; // maks 1 hari
  return true;
}

// Verifikasi WebApp initData (Mini App) — ALGORITMA RESMI Telegram.
// Catatan: secret_key di sini BEDA dari login widget (HMAC "WebAppData").
function verifyWebAppInitData(initData) {
  try {
    const botToken = process.env.BOT_TOKEN || '';
    if (!botToken || !initData) return null;
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const pairs = [];
    for (const [k, v] of params) pairs.push(`${k}=${v}`);
    pairs.sort();
    const dataCheckString = pairs.join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (computed !== hash) return null;
    const authDate = Number(params.get('auth_date') || 0);
    if (authDate && Date.now() / 1000 - authDate > 86400) return null;
    const userJson = params.get('user');
    if (!userJson) return null;
    return JSON.parse(userJson);
  } catch (e) { return null; }
}

// Token member STATELESS (ditandatangani HMAC) — tahan restart server.
const MEMBER_SECRET = process.env.BOT_TOKEN || process.env.WEB_ADMIN_PASSWORD || 'rayzell-web-secret';
const MEMBER_TTL_MS = 7 * 24 * 3600 * 1000; // 7 hari
function genMemberToken(userId) {
  const exp = Date.now() + MEMBER_TTL_MS;
  const payload = `${Number(userId)}.${exp}`;
  const sig = crypto.createHmac('sha256', MEMBER_SECRET).update(payload).digest('hex');
  return Buffer.from(payload).toString('base64url') + '.' + sig;
}
function verifyMemberToken(token) {
  try {
    const [b64, sig] = String(token || '').split('.');
    if (!b64 || !sig) return null;
    const payload = Buffer.from(b64, 'base64url').toString('utf8');
    const expected = crypto.createHmac('sha256', MEMBER_SECRET).update(payload).digest('hex');
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const [uid, exp] = payload.split('.');
    if (!uid || !exp || Date.now() > Number(exp)) return null;
    return Number(uid);
  } catch (e) { return null; }
}
function requireUser(req, res, next) {
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const uid = verifyMemberToken(t);
  if (!uid) {
    logger.warn(`[auth] member 401 hasToken=${!!t} path=${req.path}`);
    return res.status(401).json({ ok: false, message: 'Silakan login dulu.' });
  }
  req.userId = uid;
  next();
}

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
  const botUsername = String(process.env.BOT_USERNAME || '').replace(/^@/, '');
  res.json({ ok: true, data: { store: STORE_NAME, botUsername, ...CONTACT } });
});

app.get('/health', (req, res) => res.json({ ok: true }));

// ===================== MEMBER API (web belanja) =====================

// login via Telegram Login Widget
app.post('/api/auth/telegram', async (req, res) => {
  try {
    const data = req.body || {};
    const authDelta = data && data.auth_date ? Math.floor(Date.now() / 1000 - Number(data.auth_date)) : null;
    const valid = verifyTelegramAuth(data);
    logger.info(`[login] id=${data && data.id} hasHash=${!!(data && data.hash)} valid=${valid} authDeltaSec=${authDelta}`);
    if (!valid) {
      return res.status(401).json({ ok: false, message: 'Verifikasi Telegram gagal.' });
    }
    const u = await userService.ensureUser({
      id: data.id,
      first_name: data.first_name,
      last_name: data.last_name,
      username: data.username,
    });
    const token = genMemberToken(data.id);
    res.json({ ok: true, token, user: { name: u.name, balance: u.balance, role: u.role } });
  } catch (e) {
    logger.error('web /api/auth/telegram:', e.message);
    res.status(500).json({ ok: false, message: 'Terjadi kesalahan saat login.' });
  }
});

// login via Telegram Mini App (WebApp initData) — auto-login di dalam Telegram
app.post('/api/auth/webapp', async (req, res) => {
  try {
    const initData = (req.body && req.body.initData) || '';
    const u = verifyWebAppInitData(initData);
    logger.info(`[webapp-login] valid=${!!u} id=${u && u.id}`);
    if (!u || !u.id) return res.status(401).json({ ok: false, message: 'Verifikasi Mini App gagal.' });
    const user = await userService.ensureUser({ id: u.id, first_name: u.first_name, last_name: u.last_name, username: u.username });
    const token = genMemberToken(u.id);
    res.json({ ok: true, token, user: { name: user.name, balance: user.balance, role: user.role } });
  } catch (e) {
    logger.error('web /api/auth/webapp:', e.message);
    res.status(500).json({ ok: false, message: 'Terjadi kesalahan saat login.' });
  }
});

// profil member (saldo dll)
app.get('/api/me', requireUser, async (req, res) => {
  try {
    const u = await userService.getUser(req.userId);
    if (!u) return res.status(401).json({ ok: false, message: 'Akun tidak ditemukan.' });
    res.json({ ok: true, data: { name: u.name, balance: u.balance, role: u.role } });
  } catch (e) {
    logger.error('web /api/me:', e.message);
    res.json({ ok: false, message: e.message });
  }
});

// katalog kategori (publik) — sama seperti /api/products
app.get('/api/catalog', async (req, res) => {
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
    logger.error('web /api/catalog:', e.message);
    res.json({ ok: false, data: [] });
  }
});

// brand per kategori (publik)
app.get('/api/catalog/brands', async (req, res) => {
  try {
    const category = String(req.query.category || '').trim();
    if (!category) return res.json({ ok: false, data: [] });
    const rows = await productService.getBrands(category);
    res.json({ ok: true, data: rows.map((r) => ({ brand: r.brand, c: r.c })) });
  } catch (e) {
    logger.error('web /api/catalog/brands:', e.message);
    res.json({ ok: false, data: [] });
  }
});

// produk per brand (publik) — harga jual role MEMBER
app.get('/api/catalog/items', async (req, res) => {
  try {
    const category = String(req.query.category || '').trim();
    const brand = String(req.query.brand || '').trim();
    if (!category || !brand) return res.json({ ok: false, data: [] });
    const rows = await productService.getProductsByBrand(category, brand);
    const data = rows.map((p) => {
      const price = sellPrice(p, 'MEMBER');
      return { sku: p.buyer_sku_code, name: p.product_name, price, priceText: rupiah(price) };
    });
    res.json({ ok: true, data });
  } catch (e) {
    logger.error('web /api/catalog/items:', e.message);
    res.json({ ok: false, data: [] });
  }
});

// beli produk (SALDO atau QRIS)
app.post('/api/order', requireUser, async (req, res) => {
  try {
    const { sku, target, method } = req.body || {};
    const product = await productService.getProduct(sku);
    if (!product) return res.json({ ok: false, message: 'Produk tidak ditemukan.' });

    const user = await userService.getUser(req.userId);
    if (!user) return res.status(401).json({ ok: false, message: 'Akun tidak ditemukan.' });

    const harga = sellPrice(product, user.role);
    const tujuan = String(target || '').trim();
    if (!tujuan) return res.json({ ok: false, message: 'Nomor tujuan tidak boleh kosong.' });

    // ===== Bayar pakai SALDO =====
    if (method === 'saldo') {
      if (user.balance < harga) return res.json({ ok: false, message: 'Saldo tidak cukup.' });

      const refId = trxCode('CHO');
      try {
        await userService.addBalance(req.userId, -harga); // potong dulu
      } catch (e) {
        return res.json({ ok: false, message: e.message || 'Gagal memotong saldo.' });
      }

      await trxService.createTransaction({
        ref_id: refId,
        user_id: req.userId,
        buyer_sku_code: sku,
        product_name: product.product_name,
        target: tujuan,
        cost_price: product.price,
        sell_price: harga,
        status: 'Pending',
      });

      let result;
      try {
        result = await digiflazz.topUp({ buyerSkuCode: sku, customerNo: tujuan, refId });
      } catch (e) {
        logger.error('web order digiflazz error:', e.message);
        await userService.addBalance(req.userId, harga); // refund
        await trxService.updateTransaction(refId, { status: 'Gagal', message: 'Gagal terhubung ke provider' });
        return res.json({ ok: false, message: 'Gagal menghubungi provider. Saldo dikembalikan.' });
      }

      const status = digiflazz.mapStatus(result.status);
      if (status === 'Gagal') {
        await userService.addBalance(req.userId, harga); // refund
        await trxService.updateTransaction(refId, { status: 'Gagal', message: result.message || '', sn: result.sn || null });
        return res.json({ ok: false, message: result.message || 'Transaksi gagal, saldo dikembalikan.' });
      }

      await trxService.updateTransaction(refId, { status, sn: result.sn || null, message: result.message || '' });
      const updated = await userService.getUser(req.userId);
      return res.json({
        ok: true,
        method: 'saldo',
        ref: refId,
        status,
        sn: result.sn || null,
        product: product.product_name,
        target: tujuan,
        balance: updated.balance,
      });
    }

    // ===== Bayar pakai QRIS =====
    if (method === 'qris') {
      if (!config.qris.enabled) return res.json({ ok: false, message: 'QRIS sedang tidak tersedia.' });
      const { total, fee } = autogopay.computeTotal(harga);
      let qr;
      try {
        qr = await autogopay.generateQris(total);
      } catch (e) {
        logger.error('web order generateQris error:', e.message);
        return res.json({ ok: false, message: 'Gagal membuat QRIS. Coba lagi.' });
      }
      await qrisService.create({
        transaction_id: qr.transaction_id,
        order_id: qr.order_id,
        user_id: req.userId,
        chat_id: req.userId,
        message_id: null,
        purpose: 'order',
        base_amount: harga,
        fee,
        amount: total,
        payload: { sku, target: tujuan, product_name: product.product_name, cost_price: product.price },
        expiry_at: autogopay.parseExpiry(qr.expiry_time),
      });
      return res.json({
        ok: true,
        method: 'qris',
        transaction_id: qr.transaction_id,
        qr_url: qr.qr_url,
        amount: total,
        amountText: rupiah(total),
      });
    }

    return res.json({ ok: false, message: 'Metode pembayaran tidak dikenal.' });
  } catch (e) {
    logger.error('web /api/order:', e.message);
    res.json({ ok: false, message: 'Terjadi kesalahan saat memproses pesanan.' });
  }
});

// top up saldo (QRIS only)
app.post('/api/topup', requireUser, async (req, res) => {
  try {
    const amount = parseInt(req.body && req.body.amount, 10);
    if (!Number.isFinite(amount) || amount < config.topup.min) {
      return res.json({ ok: false, message: `Minimal top up ${rupiah(config.topup.min)}.` });
    }
    if (!config.qris.enabled) return res.json({ ok: false, message: 'QRIS sedang tidak tersedia.' });

    const { total, fee } = autogopay.computeTotal(amount);
    let qr;
    try {
      qr = await autogopay.generateQris(total);
    } catch (e) {
      logger.error('web topup generateQris error:', e.message);
      return res.json({ ok: false, message: 'Gagal membuat QRIS. Coba lagi.' });
    }
    await qrisService.create({
      transaction_id: qr.transaction_id,
      order_id: qr.order_id,
      user_id: req.userId,
      chat_id: req.userId,
      message_id: null,
      purpose: 'topup',
      base_amount: amount,
      fee,
      amount: total,
      payload: { nominal: amount },
      expiry_at: autogopay.parseExpiry(qr.expiry_time),
    });
    res.json({
      ok: true,
      transaction_id: qr.transaction_id,
      qr_url: qr.qr_url,
      amount,
      amountText: rupiah(amount),
    });
  } catch (e) {
    logger.error('web /api/topup:', e.message);
    res.json({ ok: false, message: 'Terjadi kesalahan saat membuat top up.' });
  }
});

// status pembayaran QRIS (milik member sendiri)
app.get('/api/qris/:txId', requireUser, async (req, res) => {
  try {
    const row = await qrisService.get(String(req.params.txId || '').trim());
    if (!row || Number(row.user_id) !== Number(req.userId)) {
      return res.status(404).json({ ok: false });
    }
    res.json({ ok: true, status: row.status, purpose: row.purpose });
  } catch (e) {
    logger.error('web /api/qris:', e.message);
    res.status(404).json({ ok: false });
  }
});

// riwayat gabungan (beli + top up)
app.get('/api/history', requireUser, async (req, res) => {
  try {
    const [trx, tops] = await Promise.all([
      trxService.getUserTransactions(req.userId, 15),
      depositService.userDeposits(req.userId, 15),
    ]);
    const items = [];
    for (const t of trx) {
      items.push({
        created_at: Number(t.created_at),
        type: 'beli',
        title: t.product_name || 'Pembelian',
        target: maskTarget(t.target),
        amountText: rupiah(t.sell_price),
        status: t.status,
        waktu: tanggal(Number(t.created_at)),
        ref: t.ref_id,
      });
    }
    for (const d of tops) {
      items.push({
        created_at: Number(d.created_at),
        type: 'topup',
        title: 'Top Up Saldo',
        target: null,
        amountText: rupiah(d.amount),
        status: d.status,
        waktu: tanggal(Number(d.created_at)),
        ref: `#${d.id}`,
      });
    }
    items.sort((a, b) => b.created_at - a.created_at);
    res.json({ ok: true, data: items.slice(0, 12) });
  } catch (e) {
    logger.error('web /api/history:', e.message);
    res.json({ ok: false, data: [] });
  }
});

// ===================== ADMIN API =====================

// login
app.post('/api/admin/login', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!checkLoginRate(ip)) {
    logger.warn(`[admin-login] rate-limit hit ip=${ip}`);
    return res.status(429).json({ ok: false, message: 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.' });
  }
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
