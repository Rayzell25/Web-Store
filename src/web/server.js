'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { all, one, query, init } = require('../db/database');
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

// kredensial admin web (dari .env) — mendukung login via email atau username
const WEB_ADMIN_EMAIL = process.env.WEB_ADMIN_EMAIL || 'admin@rayzell.id';
const WEB_ADMIN_USER  = process.env.WEB_ADMIN_USER  || 'admin';
const WEB_ADMIN_PASS  = process.env.WEB_ADMIN_PASSWORD || 'admin123';

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
if (WEB_ADMIN_EMAIL === 'admin@rayzell.id') {
  console.warn('[SECURITY] WEB_ADMIN_EMAIL masih default — ganti di .env!');
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

// ===== Google OAuth: state bertanda-tangan (anti-tamper / anti-CSRF) =====
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 menit
function makeOAuthState(linkUserId) {
  const payload = JSON.stringify({
    l: linkUserId ? Number(linkUserId) : 0,
    n: crypto.randomBytes(8).toString('hex'),
    e: Date.now() + OAUTH_STATE_TTL_MS,
  });
  const b64 = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', MEMBER_SECRET).update(b64).digest('hex');
  return b64 + '.' + sig;
}
function readOAuthState(state) {
  try {
    const [b64, sig] = String(state || '').split('.');
    if (!b64 || !sig) return null;
    const expected = crypto.createHmac('sha256', MEMBER_SECRET).update(b64).digest('hex');
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (!data || Date.now() > Number(data.e)) return null;
    return data;
  } catch (e) { return null; }
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
// limit 6mb supaya upload foto produk (base64) muat. Endpoint lain payload-nya kecil.
app.use(express.json({ limit: '6mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// folder upload foto produk (di-serve via express.static -> /uploads/<file>)
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

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

// ===== STOREFRONT (beranda gaya Ditopup): kategori -> daftar BRAND + logo =====
app.get('/api/storefront', async (req, res) => {
  try {
    const rows = await all(
      `SELECT category, brand, COUNT(*)::int AS count, MIN(price)::bigint AS minprice
         FROM products WHERE status = 'active'
        GROUP BY category, brand ORDER BY category, brand`
    );
    const logoRows = await all("SELECT key, value FROM settings WHERE key LIKE 'brandlogo:%'");
    const logoMap = {};
    for (const r of logoRows) logoMap[r.key.slice('brandlogo:'.length)] = r.value;

    const byCat = new Map();
    for (const r of rows) {
      const harga = sellPrice(
        { price: Number(r.minprice), category: r.category, buyer_sku_code: '' },
        'MEMBER'
      );
      const key = String(r.brand || '-').trim().toUpperCase();
      if (!byCat.has(r.category)) byCat.set(r.category, []);
      byCat.get(r.category).push({
        brand: r.brand,
        count: r.count,
        startFrom: harga,
        startFromText: rupiah(harga),
        logo: logoMap[key] || null,
      });
    }
    const data = [...byCat.entries()].map(([category, brands]) => ({ category, brands }));
    res.json({ ok: true, data });
  } catch (e) {
    logger.error('web /api/storefront:', e.message);
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

// info kontak & nama toko (store + logo diambil dari konfigurasi tampilan/CMS)
app.get('/api/info', async (req, res) => {
  const botUsername = String(process.env.BOT_USERNAME || '').replace(/^@/, '');
  let store = STORE_NAME, logoUrl = '';
  try { const s = await getSite(); store = s.storeName || STORE_NAME; logoUrl = s.logoUrl || ''; } catch (e) { /* fallback default */ }
  res.json({ ok: true, data: { store, logoUrl, botUsername, googleEnabled: config.google.enabled, ...CONTACT } });
});

// konfigurasi tampilan web (publik) — dipakai beranda untuk render konten
app.get('/api/site', async (req, res) => {
  try { res.json({ ok: true, data: await getSite() }); }
  catch (e) { logger.error('web /api/site:', e.message); res.json({ ok: false, data: null }); }
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

// ===================== GOOGLE OAUTH (opsional) =====================
// Aktif hanya bila GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI di-set di .env.
// Alur: /api/auth/google?link=<token?>  -> redirect ke Google
//       /api/auth/google/callback       -> tukar code, verifikasi, login/link

// helper: tukar authorization code -> tokens, lalu ambil profil dari id_token
async function googleExchange(code) {
  const body = new URLSearchParams({
    code,
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    redirect_uri: config.google.redirectUri,
    grant_type: 'authorization_code',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!r.ok) throw new Error('Gagal tukar token Google (' + r.status + ')');
  const tok = await r.json();
  if (!tok.id_token) throw new Error('id_token tidak ada');
  // Verifikasi id_token via tokeninfo (cukup & sederhana untuk server-side).
  const infoR = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(tok.id_token));
  if (!infoR.ok) throw new Error('Gagal verifikasi id_token Google');
  const info = await infoR.json();
  if (String(info.aud) !== String(config.google.clientId)) throw new Error('Audience id_token tidak cocok');
  if (!info.sub) throw new Error('Profil Google tidak valid');
  return { sub: info.sub, email: info.email || null, name: info.name || info.email || 'Google User' };
}

function htmlRedirect(res, message, token) {
  // halaman kecil yang menyimpan token (kalau ada) lalu pindah ke /app.html
  const safeMsg = String(message || '').replace(/[<>&]/g, '');
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;background:#070711;color:#e8e9f3;display:grid;place-items:center;min-height:100vh;margin:0}</style></head>
<body><div style="text-align:center"><div style="font-size:13px;opacity:.8">${safeMsg}</div></div>
<script>try{${token ? `localStorage.setItem('member_token', ${JSON.stringify(token)});` : ''}}catch(e){}
setTimeout(function(){location.replace('/app.html');}, 600);</script></body></html>`);
}

// mulai OAuth -> redirect ke Google
app.get('/api/auth/google', (req, res) => {
  if (!config.google.enabled) return res.status(404).send('Google login tidak aktif.');
  // Kalau ada Bearer token member valid -> mode LINK (hubungkan ke akun ini).
  let linkUserId = 0;
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
    || String(req.query.link || '').trim();
  const uid = verifyMemberToken(t);
  if (uid) linkUserId = uid;
  const state = makeOAuthState(linkUserId);
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
    access_type: 'online',
  });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
});

// callback dari Google
app.get('/api/auth/google/callback', async (req, res) => {
  if (!config.google.enabled) return res.status(404).send('Google login tidak aktif.');
  try {
    const code = String(req.query.code || '');
    const st = readOAuthState(req.query.state);
    if (!code || !st) return htmlRedirect(res, 'Sesi login Google kedaluwarsa. Coba lagi.');

    const profile = await googleExchange(code);
    const link = await one('SELECT user_id FROM google_links WHERE google_sub = $1', [profile.sub]);

    // Sudah pernah terhubung -> login langsung ke user tsb.
    if (link && link.user_id) {
      const token = genMemberToken(link.user_id);
      return htmlRedirect(res, 'Login Google berhasil. Mengalihkan…', token);
    }

    // Mode LINK: ada user Telegram aktif -> hubungkan Google ke akun itu.
    if (st.l) {
      const u = await userService.getUser(st.l);
      if (!u) return htmlRedirect(res, 'Akun tidak ditemukan. Login Telegram dulu.');
      await query(
        `INSERT INTO google_links (google_sub, user_id, email, name, created_at)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (google_sub) DO UPDATE SET user_id = $2, email = $3`,
        [profile.sub, Number(st.l), profile.email, profile.name, Date.now()]
      );
      const token = genMemberToken(st.l);
      return htmlRedirect(res, 'Akun Google berhasil dihubungkan!', token);
    }

    // Belum terhubung & tidak ada sesi Telegram ->
    // Buat/cari akun berbasis Google sub (ID = hash negatif besar, tidak tabrakan dgn Telegram).
    // Dengan begitu siapa saja bisa login Google tanpa perlu Telegram dulu.
    const googleUserId = -(Math.abs(parseInt(
      require('crypto').createHash('sha256').update(profile.sub).digest('hex').slice(0, 12), 16
    )) % 900000000000 + 100000000000); // rentang -100000000000 s/d -999999999999
    let gUser = await userService.getUser(googleUserId);
    if (!gUser) {
      gUser = await userService.ensureUser({
        id: googleUserId,
        first_name: (profile.name || profile.email || 'Google').split(' ')[0],
        last_name: (profile.name || '').split(' ').slice(1).join(' ') || undefined,
        username: null,
      });
    }
    await query(
      `INSERT INTO google_links (google_sub, user_id, email, name, created_at)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (google_sub) DO UPDATE SET user_id = $2, email = $3`,
      [profile.sub, googleUserId, profile.email, profile.name, Date.now()]
    );
    const token = genMemberToken(googleUserId);
    return htmlRedirect(res, 'Login Google berhasil. Mengalihkan…', token);
  } catch (e) {
    logger.error('web google callback:', e.message);
    return htmlRedirect(res, 'Login Google gagal. Coba lagi.');
  }
});

// status link Google untuk member yang sedang login
app.get('/api/auth/google/status', requireUser, async (req, res) => {
  try {
    const row = await one('SELECT email FROM google_links WHERE user_id = $1', [req.userId]);
    res.json({ ok: true, linked: !!row, email: row ? row.email : null });
  } catch (e) {
    res.json({ ok: false, linked: false });
  }
});

// profil member (saldo dll)
app.get('/api/me', requireUser, async (req, res) => {
  try {
    const u = await userService.getUser(req.userId);
    if (!u) return res.status(401).json({ ok: false, message: 'Akun tidak ditemukan.' });
    res.json({ ok: true, data: { id: u.id, name: u.name, balance: u.balance, role: u.role } });
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
      return { sku: p.buyer_sku_code, name: p.product_name, price, priceText: rupiah(price), banner: p.banner_url || null };
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

    // Anti DOBEL: cegah double-charge bila tombol beli ditekan berkali-kali.
    // Blokir bila masih Pending, atau baru saja SUKSES (cooldown). Gagal -> boleh ulang.
    const dupTrx = await trxService.findDuplicate(req.userId, sku, tujuan, (config.order.dedupeSec || 0) * 1000);
    if (dupTrx) {
      const message = dupTrx.status === 'Pending'
        ? 'Masih ada transaksi ke nomor ini yang sedang diproses. Tunggu hingga selesai.'
        : `Kamu baru saja beli produk ini ke nomor ini. Tunggu ${config.order.dedupeSec} detik bila memang mau beli lagi.`;
      return res.json({ ok: false, message });
    }

    // ===== Bayar pakai SALDO =====
    if (method === 'saldo') {
      if (user.balance < harga) return res.json({ ok: false, message: 'Saldo tidak cukup.' });

      const refId = trxCode('RAYZELL-');
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
      const saldoHabis = digiflazz.isSaldoHabis(result);
      // GAGAL eksplisit ATAU deposit Digiflazz habis -> refund SEGERA (jangan
      // biarkan Pending/saldo pembeli ketahan). Pembeli beli ulang nanti.
      if (status === 'Gagal' || (saldoHabis && status !== 'Sukses')) {
        await userService.addBalance(req.userId, harga); // refund
        await trxService.updateTransaction(refId, {
          status: 'Gagal',
          message: result.message || (saldoHabis ? 'Deposit provider habis' : ''),
          sn: result.sn || null,
        });
        return res.json({
          ok: false,
          message: saldoHabis
            ? 'Transaksi gagal diproses (stok provider sedang kosong). Saldo dikembalikan, silakan coba lagi nanti.'
            : (result.message || 'Transaksi gagal, saldo dikembalikan.'),
        });
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

// login — mendukung email atau username
app.post('/api/admin/login', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!checkLoginRate(ip)) {
    logger.warn(`[admin-login] rate-limit hit ip=${ip}`);
    return res.status(429).json({ ok: false, message: 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.' });
  }
  const { email, username, password } = req.body || {};
  const inputId = String(email || username || '').trim();
  const inputPass = String(password || '');
  const emailMatch = inputId === WEB_ADMIN_EMAIL && inputPass === WEB_ADMIN_PASS;
  const userMatch  = inputId === WEB_ADMIN_USER  && inputPass === WEB_ADMIN_PASS;
  if (emailMatch || userMatch) {
    const adminInfo = { email: WEB_ADMIN_EMAIL };
    return res.json({ ok: true, token: genToken(), admin: adminInfo });
  }
  logger.warn(`[admin-login] gagal ip=${ip} inputId=${inputId}`);
  res.status(401).json({ ok: false, message: 'Email atau password salah.' });
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

// transaksi — dengan pagination, filter status, dan search
app.get('/api/admin/transactions', requireAdmin, async (req, res) => {
  try {
    const limit  = Math.min(Number(req.query.limit  || 50), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const status = String(req.query.status || '').trim();
    const search = String(req.query.search || '').trim();
    const params = [];
    const conds  = [];
    if (status) { conds.push(`status = $${params.length+1}`); params.push(status); }
    if (search) {
      conds.push(`(ref_id ILIKE $${params.length+1} OR target ILIKE $${params.length+1} OR product_name ILIKE $${params.length+1})`);
      params.push(`%${search}%`);
    }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const [rows, countRow] = await Promise.all([
      all(
        `SELECT t.ref_id, t.product_name, t.target, t.sell_price, t.cost_price, t.status, t.sn, t.message, t.created_at, u.name as user_name
           FROM transactions t LEFT JOIN users u ON u.id = t.user_id
           ${where} ORDER BY t.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`,
        [...params, limit, offset]
      ),
      one(`SELECT COUNT(*)::int AS c FROM transactions ${where}`, params),
    ]);
    res.json({
      ok: true,
      total: countRow ? countRow.c : 0,
      data: rows.map((r) => ({
        ref_id: r.ref_id,
        product_name: r.product_name,
        target: r.target,
        sell_price: r.sell_price,
        cost_price: r.cost_price,
        status: r.status,
        sn: r.sn,
        message: r.message,
        user_name: r.user_name || '-',
        waktu: tanggal(Number(r.created_at)),
      })),
    });
  } catch (e) {
    logger.error('web /api/admin/transactions:', e.message);
    res.json({ ok: false, message: e.message });
  }
});

// ===================== ADMIN: MANAJEMEN PENGGUNA =====================

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const limit  = Math.min(Number(req.query.limit  || 50), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const search = String(req.query.search || '').trim();
    const params = [];
    let where = '';
    if (search) {
      where = `WHERE (name ILIKE $1 OR username ILIKE $1 OR id::text ILIKE $1)`;
      params.push(`%${search}%`);
    }
    const [rows, countRow] = await Promise.all([
      all(
        `SELECT id, username, name, balance, role, banned, created_at FROM users ${where} ORDER BY created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`,
        [...params, limit, offset]
      ),
      one(`SELECT COUNT(*)::int AS c FROM users ${where}`, params),
    ]);
    res.json({
      ok: true,
      total: countRow ? countRow.c : 0,
      data: rows.map((r) => ({
        id: r.id,
        username: r.username,
        name: r.name,
        balance: r.balance,
        role: r.role,
        banned: r.banned,
        waktu: tanggal(Number(r.created_at)),
      })),
    });
  } catch (e) {
    logger.error('web /api/admin/users:', e.message);
    res.json({ ok: false, message: e.message });
  }
});

// adjust saldo user
app.post('/api/admin/users/:id/balance', requireAdmin, async (req, res) => {
  try {
    const uid   = Number(req.params.id);
    const delta = parseInt(req.body && req.body.delta, 10);
    if (!Number.isFinite(delta)) return res.json({ ok: false, message: 'delta harus angka.' });
    const user = await userService.getUser(uid);
    if (!user) return res.json({ ok: false, message: 'User tidak ditemukan.' });
    await userService.addBalance(uid, delta);
    const updated = await userService.getUser(uid);
    res.json({ ok: true, message: `Saldo ${user.name} ${delta >= 0 ? '+' : ''}${rupiah(delta)}.`, balance: updated.balance });
  } catch (e) {
    logger.error('web /api/admin/users/balance:', e.message);
    res.json({ ok: false, message: e.message });
  }
});

// ubah role user
app.post('/api/admin/users/:id/role', requireAdmin, async (req, res) => {
  try {
    const uid  = Number(req.params.id);
    const role = String(req.body && req.body.role || '').toUpperCase();
    const allowed = ['MEMBER', 'RESELLER', 'VIP', 'ADMIN'];
    if (!allowed.includes(role)) return res.json({ ok: false, message: 'Role tidak valid.' });
    await query('UPDATE users SET role=$1, updated_at=$2 WHERE id=$3', [role, Date.now(), uid]);
    res.json({ ok: true, message: `Role user diubah ke ${role}.` });
  } catch (e) {
    logger.error('web /api/admin/users/role:', e.message);
    res.json({ ok: false, message: e.message });
  }
});

// ban/unban user
app.post('/api/admin/users/:id/ban', requireAdmin, async (req, res) => {
  try {
    const uid    = Number(req.params.id);
    const banned = !!req.body.banned;
    await query('UPDATE users SET banned=$1, updated_at=$2 WHERE id=$3', [banned, Date.now(), uid]);
    res.json({ ok: true, message: `User ${banned ? 'diblokir' : 'diaktifkan kembali'}.` });
  } catch (e) {
    logger.error('web /api/admin/users/ban:', e.message);
    res.json({ ok: false, message: e.message });
  }
});

// ===================== ADMIN: MULTI DIGIFLAZZ API =====================
// Disimpan di settings key 'digiflazz_accounts' sebagai JSON array.

async function getDigiAccounts() {
  try {
    const row = await one("SELECT value FROM settings WHERE key = 'digiflazz_accounts'");
    if (row && row.value) return JSON.parse(row.value) || [];
  } catch (e) { /* fallback */ }
  // fallback ke env jika belum ada data
  const envAcc = config.digiflazz.username ? [{
    id: 'default',
    label: 'Akun Utama (dari .env)',
    username: config.digiflazz.username,
    api_key: config.digiflazz.apiKey,
    mode: config.digiflazz.mode || 'prepaid',
    active: true,
    primary: true,
  }] : [];
  return envAcc;
}

async function saveDigiAccounts(accounts) {
  await query(
    "INSERT INTO settings(key, value) VALUES('digiflazz_accounts', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [JSON.stringify(accounts)]
  );
}

app.get('/api/admin/digiflazz-accounts', requireAdmin, async (req, res) => {
  try {
    const accounts = await getDigiAccounts();
    // Sembunyikan sebagian api_key untuk keamanan
    const safe = accounts.map((a) => ({
      ...a,
      api_key_masked: a.api_key ? a.api_key.slice(0, 6) + '****' + a.api_key.slice(-4) : '',
    }));
    res.json({ ok: true, data: safe });
  } catch (e) {
    logger.error('web /api/admin/digiflazz-accounts GET:', e.message);
    res.json({ ok: false, message: e.message });
  }
});

app.post('/api/admin/digiflazz-accounts', requireAdmin, async (req, res) => {
  try {
    const { label, username, api_key, mode } = req.body || {};
    if (!label || !username || !api_key) return res.json({ ok: false, message: 'label, username, api_key wajib diisi.' });
    const accounts = await getDigiAccounts();
    const id = `acc_${Date.now()}`;
    accounts.push({ id, label: String(label).slice(0,60), username: String(username), api_key: String(api_key), mode: mode || 'prepaid', active: true, primary: accounts.length === 0 });
    await saveDigiAccounts(accounts);
    res.json({ ok: true, message: 'Akun Digiflazz ditambahkan.', id });
  } catch (e) {
    logger.error('web /api/admin/digiflazz-accounts POST:', e.message);
    res.json({ ok: false, message: e.message });
  }
});

app.put('/api/admin/digiflazz-accounts/:id', requireAdmin, async (req, res) => {
  try {
    const accId = String(req.params.id);
    const accounts = await getDigiAccounts();
    const idx = accounts.findIndex((a) => a.id === accId);
    if (idx === -1) return res.json({ ok: false, message: 'Akun tidak ditemukan.' });
    const { label, username, api_key, mode, active, primary } = req.body || {};
    if (label !== undefined) accounts[idx].label = String(label).slice(0,60);
    if (username !== undefined) accounts[idx].username = String(username);
    if (api_key !== undefined && api_key && !api_key.includes('****')) accounts[idx].api_key = String(api_key);
    if (mode !== undefined) accounts[idx].mode = mode;
    if (active !== undefined) accounts[idx].active = !!active;
    if (primary) { accounts.forEach((a) => { a.primary = false; }); accounts[idx].primary = true; }
    await saveDigiAccounts(accounts);
    res.json({ ok: true, message: 'Akun diperbarui.' });
  } catch (e) {
    logger.error('web /api/admin/digiflazz-accounts PUT:', e.message);
    res.json({ ok: false, message: e.message });
  }
});

app.delete('/api/admin/digiflazz-accounts/:id', requireAdmin, async (req, res) => {
  try {
    const accId = String(req.params.id);
    let accounts = await getDigiAccounts();
    accounts = accounts.filter((a) => a.id !== accId);
    await saveDigiAccounts(accounts);
    res.json({ ok: true, message: 'Akun dihapus.' });
  } catch (e) {
    logger.error('web /api/admin/digiflazz-accounts DELETE:', e.message);
    res.json({ ok: false, message: e.message });
  }
});

// cek saldo deposit per akun Digiflazz
app.post('/api/admin/digiflazz-accounts/:id/check-deposit', requireAdmin, async (req, res) => {
  try {
    const accId = String(req.params.id);
    const accounts = await getDigiAccounts();
    const acc = accounts.find((a) => a.id === accId);
    if (!acc) return res.json({ ok: false, message: 'Akun tidak ditemukan.' });
    // Buat signature sementara pakai creds akun ini
    const md5 = (s) => require('crypto').createHash('md5').update(s).digest('hex');
    const sign = md5(acc.username + acc.api_key + 'depo');
    const axios = require('axios');
    const { data } = await axios.post('https://api.digiflazz.com/v1/cek-saldo', {
      cmd: 'deposit', username: acc.username, sign,
    }, { timeout: 15000 });
    const deposit = data && data.data ? data.data.deposit : null;
    res.json({ ok: true, deposit });
  } catch (e) {
    logger.error('web check-deposit:', e.message);
    res.json({ ok: false, message: e.message });
  }
});

// ===================== ADMIN: MARKUP HARGA =====================

app.get('/api/admin/markup', requireAdmin, async (req, res) => {
  try {
    const rows = await all('SELECT sku, type, value, updated_at FROM markups ORDER BY sku');
    res.json({ ok: true, data: rows });
  } catch (e) {
    logger.error('web /api/admin/markup GET:', e.message);
    res.json({ ok: false, message: e.message });
  }
});

app.post('/api/admin/markup', requireAdmin, async (req, res) => {
  try {
    const rules = req.body && Array.isArray(req.body.rules) ? req.body.rules : [];
    for (const r of rules) {
      const sku   = String(r.sku || '').trim();
      const type  = ['flat','percent'].includes(r.type) ? r.type : 'flat';
      const value = Number(r.value) || 0;
      if (!sku) continue;
      await query(
        `INSERT INTO markups(sku, type, value, updated_at) VALUES($1,$2,$3,$4)
         ON CONFLICT(sku) DO UPDATE SET type=EXCLUDED.type, value=EXCLUDED.value, updated_at=EXCLUDED.updated_at`,
        [sku, type, value, Date.now()]
      );
    }
    await markupService.load(); // reload cache
    res.json({ ok: true, message: `${rules.length} markup disimpan.` });
  } catch (e) {
    logger.error('web /api/admin/markup POST:', e.message);
    res.json({ ok: false, message: e.message });
  }
});

// ===================== ADMIN: STATUS PRODUK =====================

app.post('/api/admin/products/:sku/status', requireAdmin, async (req, res) => {
  try {
    const sku    = String(req.params.sku || '').trim();
    const status = String(req.body && req.body.status || '').trim();
    if (!['active','inactive'].includes(status)) return res.json({ ok: false, message: 'status harus active/inactive.' });
    const result = await query(
      'UPDATE products SET status=$1 WHERE buyer_sku_code=$2 RETURNING product_name',
      [status, sku]
    );
    if (!result.rows.length) return res.json({ ok: false, message: 'Produk tidak ditemukan.' });
    res.json({ ok: true, message: `Produk "${result.rows[0].product_name}" diubah ke ${status}.` });
  } catch (e) {
    logger.error('web /api/admin/products/status:', e.message);
    res.json({ ok: false, message: e.message });
  }
});

// ===================== ADMIN: BANNER HOMEPAGE =====================
// Disimpan di settings key 'homepage_banners' sebagai JSON array.

async function getBanners() {
  try {
    const row = await one("SELECT value FROM settings WHERE key = 'homepage_banners'");
    if (row && row.value) return JSON.parse(row.value) || [];
  } catch (e) { /* fallback */ }
  return [];
}

app.get('/api/admin/banners', requireAdmin, async (req, res) => {
  try { res.json({ ok: true, data: await getBanners() }); }
  catch (e) { res.json({ ok: false, message: e.message }); }
});

app.get('/api/banners', async (req, res) => {
  try { res.json({ ok: true, data: await getBanners() }); }
  catch (e) { res.json({ ok: true, data: [] }); }
});

app.post('/api/admin/banners', requireAdmin, async (req, res) => {
  try {
    const banners = await getBanners();
    const { title, subtitle, url, image } = req.body || {};
    let imageUrl = String(url || '').trim();
    if (image && image.startsWith('data:')) {
      const saved = saveBase64Image(image);
      if (saved.error) return res.json({ ok: false, message: saved.error });
      imageUrl = saved.url;
    }
    if (!imageUrl) return res.json({ ok: false, message: 'URL atau gambar wajib.' });
    const id = `banner_${Date.now()}`;
    banners.push({ id, title: String(title||'').slice(0,80), subtitle: String(subtitle||'').slice(0,160), imageUrl, active: true });
    await query("INSERT INTO settings(key,value) VALUES('homepage_banners',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify(banners)]);
    res.json({ ok: true, message: 'Banner ditambahkan.', id });
  } catch (e) {
    logger.error('web /api/admin/banners POST:', e.message);
    res.json({ ok: false, message: e.message });
  }
});

app.delete('/api/admin/banners/:id', requireAdmin, async (req, res) => {
  try {
    const bannerId = String(req.params.id);
    let banners = await getBanners();
    const found = banners.find((b) => b.id === bannerId);
    if (found && found.imageUrl) unlinkUpload(found.imageUrl);
    banners = banners.filter((b) => b.id !== bannerId);
    await query("INSERT INTO settings(key,value) VALUES('homepage_banners',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify(banners)]);
    res.json({ ok: true, message: 'Banner dihapus.' });
  } catch (e) {
    logger.error('web /api/admin/banners DELETE:', e.message);
    res.json({ ok: false, message: e.message });
  }
});

app.put('/api/admin/banners/:id/toggle', requireAdmin, async (req, res) => {
  try {
    const bannerId = String(req.params.id);
    const banners = await getBanners();
    const b = banners.find((x) => x.id === bannerId);
    if (!b) return res.json({ ok: false, message: 'Banner tidak ditemukan.' });
    b.active = !b.active;
    await query("INSERT INTO settings(key,value) VALUES('homepage_banners',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify(banners)]);
    res.json({ ok: true, message: `Banner ${b.active ? 'diaktifkan' : 'dinonaktifkan'}.`, active: b.active });
  } catch (e) {
    logger.error('web /api/admin/banners toggle:', e.message);
    res.json({ ok: false, message: e.message });
  }
});

// info admin (email) untuk ditampilkan di panel
app.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json({ ok: true, data: { email: WEB_ADMIN_EMAIL } });
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

// ===================== ADMIN: BANNER PRODUK =====================

// daftar kategori (buat panel banner)
app.get('/api/admin/products/categories', requireAdmin, async (req, res) => {
  try {
    const rows = await all(
      `SELECT category, COUNT(*)::int AS c FROM products WHERE status='active' GROUP BY category ORDER BY category`
    );
    res.json({ ok: true, data: rows });
  } catch (e) { res.json({ ok: false, message: e.message }); }
});

// daftar brand per kategori
app.get('/api/admin/products/brands', requireAdmin, async (req, res) => {
  try {
    const cat = String(req.query.category || '').trim();
    if (!cat) return res.json({ ok: false, data: [] });
    const rows = await all(
      `SELECT brand, COUNT(*)::int AS c FROM products WHERE status='active' AND category=$1 GROUP BY brand ORDER BY brand`,
      [cat]
    );
    res.json({ ok: true, data: rows });
  } catch (e) { res.json({ ok: false, message: e.message }); }
});

// daftar produk per brand (dengan banner_url kalau ada)
app.get('/api/admin/products/list', requireAdmin, async (req, res) => {
  try {
    const cat = String(req.query.category || '').trim();
    const brand = String(req.query.brand || '').trim();
    if (!cat || !brand) return res.json({ ok: false, data: [] });
    const rows = await all(
      `SELECT buyer_sku_code, product_name, price, banner_url FROM products WHERE status='active' AND category=$1 AND brand=$2 ORDER BY product_name`,
      [cat, brand]
    );
    res.json({ ok: true, data: rows });
  } catch (e) { res.json({ ok: false, message: e.message }); }
});

// set / hapus banner produk
app.put('/api/admin/products/:sku/banner', requireAdmin, async (req, res) => {
  try {
    const sku = String(req.params.sku || '').trim();
    if (!sku) return res.json({ ok: false, message: 'SKU tidak valid.' });
    const url = String((req.body && req.body.url) || '').trim();
    // validasi: kosong = hapus; tidak kosong harus URL valid
    if (url && !/^https?:\/\/.+/.test(url)) {
      return res.json({ ok: false, message: 'URL harus diawali https:// atau http://' });
    }
    const result = await query(
      `UPDATE products SET banner_url=$1 WHERE buyer_sku_code=$2 RETURNING buyer_sku_code, product_name, banner_url`,
      [url || null, sku]
    );
    if (!result.rows.length) return res.json({ ok: false, message: 'Produk tidak ditemukan.' });
    const p = result.rows[0];
    res.json({ ok: true, message: url ? `Banner "${p.product_name}" diset.` : `Banner "${p.product_name}" dihapus.`, data: p });
  } catch (e) {
    logger.error('web banner produk:', e.message);
    res.json({ ok: false, message: e.message });
  }
});

// ===================== ADMIN: UPLOAD GAMBAR (foto produk & logo brand) =====================
// Terima gambar base64 (dataURL), simpan ke /public/uploads. Tanpa dependency tambahan.
const ALLOWED_IMG = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const MAX_IMG_BYTES = 3 * 1024 * 1024; // 3 MB

// Decode + simpan satu gambar base64. Return { url } atau { error }.
function saveBase64Image(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([a-z0-9/+.-]+);base64,(.+)$/i);
  if (!m) return { error: 'Format gambar tidak valid.' };
  const ext = ALLOWED_IMG[m[1].toLowerCase()];
  if (!ext) return { error: 'Tipe gambar harus PNG, JPG, WEBP, atau GIF.' };
  let buf;
  try { buf = Buffer.from(m[2], 'base64'); } catch (e) { buf = null; }
  if (!buf || !buf.length) return { error: 'Gambar kosong / rusak.' };
  if (buf.length > MAX_IMG_BYTES) return { error: 'Ukuran gambar maksimal 3 MB.' };
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const fname = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, fname), buf);
  return { url: `/uploads/${fname}` };
}

// Hapus file lama bila berasal dari folder /uploads (aman terhadap path traversal).
function unlinkUpload(url) {
  const u = String(url || '');
  if (!u.startsWith('/uploads/')) return;
  try {
    const p = path.join(UPLOAD_DIR, path.basename(u));
    if (p.startsWith(UPLOAD_DIR) && fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) { /* abaikan kegagalan hapus */ }
}

// Upload foto produk (per SKU) -> set banner_url.
app.post('/api/admin/products/:sku/photo', requireAdmin, async (req, res) => {
  try {
    const sku = String(req.params.sku || '').trim();
    if (!sku) return res.json({ ok: false, message: 'SKU tidak valid.' });

    const prod = await one(
      'SELECT buyer_sku_code, product_name, banner_url FROM products WHERE buyer_sku_code = $1',
      [sku]
    );
    if (!prod) return res.json({ ok: false, message: 'Produk tidak ditemukan.' });

    const saved = saveBase64Image(req.body && req.body.data);
    if (saved.error) return res.json({ ok: false, message: saved.error });

    if (prod.banner_url) unlinkUpload(prod.banner_url);
    await query('UPDATE products SET banner_url = $1 WHERE buyer_sku_code = $2', [saved.url, sku]);
    res.json({ ok: true, message: `Foto "${prod.product_name}" diperbarui.`, url: saved.url });
  } catch (e) {
    logger.error('web upload foto produk:', e.message);
    res.json({ ok: false, message: 'Gagal mengunggah foto.' });
  }
});

// ===================== ADMIN: LOGO BRAND (untuk beranda) =====================
// Disimpan di tabel settings (key = 'brandlogo:<BRAND UPPER>'). Tanpa migrasi DB.

// daftar brand (unik) + logo saat ini
app.get('/api/admin/brandlogos', requireAdmin, async (req, res) => {
  try {
    const category = String(req.query.category || '').trim();
    const params = [];
    let where = "status = 'active'";
    if (category) { where += ' AND category = $1'; params.push(category); }
    const rows = await all(`SELECT DISTINCT brand FROM products WHERE ${where} ORDER BY brand`, params);
    const logoRows = await all("SELECT key, value FROM settings WHERE key LIKE 'brandlogo:%'");
    const logoMap = {};
    for (const r of logoRows) logoMap[r.key.slice('brandlogo:'.length)] = r.value;
    const seen = new Set();
    const data = [];
    for (const r of rows) {
      const k = String(r.brand || '-').trim().toUpperCase();
      if (seen.has(k)) continue;
      seen.add(k);
      data.push({ brand: r.brand, logo: logoMap[k] || null });
    }
    res.json({ ok: true, data });
  } catch (e) {
    logger.error('web /api/admin/brandlogos:', e.message);
    res.json({ ok: false, data: [] });
  }
});

// upload logo brand
app.post('/api/admin/brandlogos/photo', requireAdmin, async (req, res) => {
  try {
    const brand = String((req.body && req.body.brand) || '').trim();
    if (!brand) return res.json({ ok: false, message: 'Brand tidak valid.' });
    const saved = saveBase64Image(req.body && req.body.data);
    if (saved.error) return res.json({ ok: false, message: saved.error });
    const key = 'brandlogo:' + brand.toUpperCase();
    const old = await one('SELECT value FROM settings WHERE key = $1', [key]);
    if (old && old.value) unlinkUpload(old.value);
    await query(
      'INSERT INTO settings(key, value) VALUES($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [key, saved.url]
    );
    res.json({ ok: true, message: `Logo "${brand}" diperbarui.`, url: saved.url });
  } catch (e) {
    logger.error('web brandlogo upload:', e.message);
    res.json({ ok: false, message: 'Gagal mengunggah logo.' });
  }
});

// hapus logo brand
app.post('/api/admin/brandlogos/clear', requireAdmin, async (req, res) => {
  try {
    const brand = String((req.body && req.body.brand) || '').trim();
    if (!brand) return res.json({ ok: false, message: 'Brand tidak valid.' });
    const key = 'brandlogo:' + brand.toUpperCase();
    const old = await one('SELECT value FROM settings WHERE key = $1', [key]);
    if (old && old.value) unlinkUpload(old.value);
    await query('DELETE FROM settings WHERE key = $1', [key]);
    res.json({ ok: true, message: `Logo "${brand}" dihapus.` });
  } catch (e) {
    logger.error('web brandlogo clear:', e.message);
    res.json({ ok: false, message: 'Gagal menghapus logo.' });
  }
});

// ===================== PENGATURAN TAMPILAN WEB (CMS sederhana) =====================
// Disimpan sebagai 1 JSON di settings key 'site_config'. Tanpa migrasi DB.
const DEFAULT_SITE = {
  storeName: STORE_NAME,
  logoUrl: '',
  hero: {
    title: 'Top up & tagihan, murah & instan.',
    subtitle: 'Pulsa, paket data, token PLN, voucher game & e-money — harga bersaing, proses otomatis, langsung dari web maupun Telegram.',
  },
  why: {
    title: 'Kenapa pilih kami?',
    subtitle: 'Cepat, murah, dan terpercaya.',
    items: [
      { icon: '⚡', title: 'Proses Instan', desc: 'Otomatis 24 jam, masuk dalam hitungan detik.' },
      { icon: '💰', title: 'Harga Bersaing', desc: 'Murah untuk member, lebih hemat untuk reseller.' },
      { icon: '🔒', title: 'Aman & Terpercaya', desc: 'Login terverifikasi, transaksi tercatat rapi.' },
      { icon: '🎧', title: 'CS Responsif', desc: 'Bantuan cepat via WhatsApp & Telegram.' },
    ],
  },
  contact: { title: 'Kontak', subtitle: 'Butuh bantuan? Hubungi kami.' },
  footer: { about: 'Layanan top up & pembayaran tagihan otomatis 24 jam: pulsa, paket data, token PLN, voucher game, dan e-money. Cepat, murah, terpercaya.' },
};
function clampStr(v, max) { return String(v == null ? '' : v).slice(0, max); }

async function getSite() {
  let stored = {};
  try {
    const row = await one("SELECT value FROM settings WHERE key = 'site_config'");
    if (row && row.value) stored = JSON.parse(row.value) || {};
  } catch (e) { stored = {}; }
  const s = stored || {};
  const w = s.why || {};
  return {
    storeName: s.storeName || DEFAULT_SITE.storeName,
    logoUrl: s.logoUrl || '',
    hero: {
      title: (s.hero && s.hero.title) || DEFAULT_SITE.hero.title,
      subtitle: (s.hero && s.hero.subtitle) || DEFAULT_SITE.hero.subtitle,
    },
    why: {
      title: w.title || DEFAULT_SITE.why.title,
      subtitle: w.subtitle || DEFAULT_SITE.why.subtitle,
      items: (Array.isArray(w.items) && w.items.length) ? w.items : DEFAULT_SITE.why.items,
    },
    contact: {
      title: (s.contact && s.contact.title) || DEFAULT_SITE.contact.title,
      subtitle: (s.contact && s.contact.subtitle) || DEFAULT_SITE.contact.subtitle,
    },
    footer: { about: (s.footer && s.footer.about) || DEFAULT_SITE.footer.about },
  };
}
async function saveSiteConfig(cfg) {
  await query(
    "INSERT INTO settings(key, value) VALUES('site_config', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [JSON.stringify(cfg)]
  );
}

// baca konfigurasi (admin)
app.get('/api/admin/site', requireAdmin, async (req, res) => {
  try { res.json({ ok: true, data: await getSite() }); }
  catch (e) { logger.error('web /api/admin/site:', e.message); res.json({ ok: false }); }
});

// simpan teks/konten (logo dikelola endpoint terpisah agar tidak terhapus)
app.post('/api/admin/site', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const cur = await getSite();
    let items = cur.why.items;
    if (b.why && Array.isArray(b.why.items)) {
      items = b.why.items.slice(0, 12)
        .map((it) => ({ icon: clampStr(it.icon, 8), title: clampStr(it.title, 60), desc: clampStr(it.desc, 160) }))
        .filter((it) => it.title || it.desc);
    }
    const cfg = {
      storeName: clampStr(b.storeName, 60) || cur.storeName,
      logoUrl: cur.logoUrl,
      hero: {
        title: clampStr(b.hero && b.hero.title, 90) || cur.hero.title,
        subtitle: clampStr(b.hero && b.hero.subtitle, 220) || cur.hero.subtitle,
      },
      why: {
        title: clampStr(b.why && b.why.title, 80) || cur.why.title,
        subtitle: clampStr(b.why && b.why.subtitle, 160) || cur.why.subtitle,
        items: items.length ? items : cur.why.items,
      },
      contact: {
        title: clampStr(b.contact && b.contact.title, 60) || cur.contact.title,
        subtitle: clampStr(b.contact && b.contact.subtitle, 160) || cur.contact.subtitle,
      },
      footer: { about: clampStr(b.footer && b.footer.about, 400) || cur.footer.about },
    };
    await saveSiteConfig(cfg);
    res.json({ ok: true, message: 'Pengaturan tampilan disimpan.', data: cfg });
  } catch (e) {
    logger.error('web save site:', e.message);
    res.json({ ok: false, message: 'Gagal menyimpan pengaturan.' });
  }
});

// upload / hapus logo web
app.post('/api/admin/site/logo', requireAdmin, async (req, res) => {
  try {
    const cfg = await getSite();
    if (req.body && req.body.clear) {
      if (cfg.logoUrl) unlinkUpload(cfg.logoUrl);
      cfg.logoUrl = '';
      await saveSiteConfig(cfg);
      return res.json({ ok: true, message: 'Logo web dihapus.', url: '' });
    }
    const saved = saveBase64Image(req.body && req.body.data);
    if (saved.error) return res.json({ ok: false, message: saved.error });
    if (cfg.logoUrl) unlinkUpload(cfg.logoUrl);
    cfg.logoUrl = saved.url;
    await saveSiteConfig(cfg);
    res.json({ ok: true, message: 'Logo web diperbarui.', url: saved.url });
  } catch (e) {
    logger.error('web site logo:', e.message);
    res.json({ ok: false, message: 'Gagal mengunggah logo.' });
  }
});

async function startWeb() {
  await init();
  await markupService.load();
  // pastikan folder upload ada sebelum melayani request
  try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) { /* abaikan */ }
  app.listen(PORT, '127.0.0.1', () => {
    logger.info(`Web storefront jalan di http://127.0.0.1:${PORT}`);
  });
}

startWeb().catch((e) => {
  logger.error('Gagal start web:', e.message);
  process.exit(1);
});
