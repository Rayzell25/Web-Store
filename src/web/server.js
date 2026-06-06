'use strict';

const path = require('path');
const express = require('express');
const { all, one, init } = require('../db/database');
const markupService = require('../services/markupService');
const { sellPrice } = require('../services/productService');
const { rupiah, tanggal } = require('../utils/format');
const logger = require('../utils/logger');

const PORT = Number(process.env.WEB_PORT || 3000);
const STORE_NAME = process.env.STORE_NAME || 'Rayzell Store PPOB';

// kontak (non-sensitif)
function waNumber() {
  let n = String(process.env.CONTACT_WA || '6287826532525').replace(/[^\d]/g, '');
  if (n.startsWith('0')) n = '62' + n.slice(1);
  return n;
}
const CONTACT = {
  waLink: `https://wa.me/${waNumber()}`,
  tgLink: process.env.CONTACT_TG || 'https://t.me/Rayzell23',
  // tombol "Beli" mengarah ke bot; fallback ke kontak telegram bila BOT_USERNAME kosong
  botLink: process.env.BOT_USERNAME
    ? `https://t.me/${String(process.env.BOT_USERNAME).replace(/^@/, '')}`
    : (process.env.CONTACT_TG || 'https://t.me/Rayzell23'),
};

function maskTarget(t) {
  const s = String(t || '');
  if (s.length <= 5) return s;
  return s.slice(0, 3) + '****' + s.slice(-2);
}

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public')));

// ---- API: ringkasan etalase per kategori ----
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

// ---- API: cek status transaksi by ref_id ----
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

// ---- API: info kontak & nama toko ----
app.get('/api/info', (req, res) => {
  res.json({ ok: true, data: { store: STORE_NAME, ...CONTACT } });
});

app.get('/health', (req, res) => res.json({ ok: true }));

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
