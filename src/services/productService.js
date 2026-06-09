'use strict';

const { one, all, withTx } = require('../db/database');

function now() {
  return Date.now();
}

/**
 * Simpan/replace daftar produk hasil sinkron dari Digiflazz.
 *
 * Selain upsert, produk yang TIDAK ada lagi di price-list terbaru (mis. sudah
 * dihapus/dinonaktifkan di panel Digiflazz) akan DIHAPUS dari DB supaya tidak
 * "nyangkut" / terlihat dobel di bot & web. Aman: tabel transactions menyimpan
 * product_name sendiri (tidak ada foreign key ke products), jadi riwayat tetap utuh.
 *
 * Penghapusan hanya dilakukan bila list TIDAK kosong, untuk mencegah seluruh
 * katalog terhapus saat Digiflazz balas list kosong (mis. error/rate-limit).
 */
async function upsertProducts(list) {
  if (!Array.isArray(list) || list.length === 0) return 0;
  const syncStamp = now();
  await withTx(async (client) => {
    for (const p of list) {
      await client.query(
        `INSERT INTO products (buyer_sku_code, product_name, category, brand, type, price, "desc", status, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (buyer_sku_code) DO UPDATE SET
           product_name = EXCLUDED.product_name,
           category = EXCLUDED.category,
           brand = EXCLUDED.brand,
           type = EXCLUDED.type,
           price = EXCLUDED.price,
           "desc" = EXCLUDED."desc",
           status = EXCLUDED.status,
           updated_at = EXCLUDED.updated_at`,
        [
          p.buyer_sku_code,
          p.product_name,
          p.category || 'Lainnya',
          p.brand || '-',
          p.type || '-',
          Math.round(Number(p.price) || 0),
          p.desc || null,
          p.buyer_product_status && p.seller_product_status ? 'active' : 'gangguan',
          syncStamp,
        ]
      );
    }
    // Produk yang tidak ikut di sync ini (updated_at < syncStamp) = sudah tidak
    // ada di Digiflazz -> hapus supaya bot & web bersih (tidak ada sisa/dobel).
    await client.query('DELETE FROM products WHERE updated_at < $1', [syncStamp]);
  });
  return list.length;
}

function getCategories() {
  return all(
    `SELECT category, COUNT(*)::int AS c FROM products
      WHERE status = 'active' GROUP BY category ORDER BY category`
  );
}

function getBrands(category) {
  return all(
    `SELECT brand, COUNT(*)::int AS c FROM products
      WHERE status = 'active' AND category = $1 GROUP BY brand ORDER BY brand`,
    [category]
  );
}

function getProductsByBrand(category, brand) {
  return all(
    `SELECT * FROM products
      WHERE status = 'active' AND category = $1 AND brand = $2
      ORDER BY price ASC`,
    [category, brand]
  );
}

function getProduct(sku) {
  return one('SELECT * FROM products WHERE buyer_sku_code = $1', [sku]);
}

async function countProducts() {
  const r = await one('SELECT COUNT(*)::int AS c FROM products');
  return r.c;
}

/** Harga jual = modal + markup. Sinkron (markupService memakai cache). */
function sellPrice(product, role) {
  return require('./markupService').sellPrice(product, role);
}

module.exports = {
  upsertProducts,
  getCategories,
  getBrands,
  getProductsByBrand,
  getProduct,
  countProducts,
  sellPrice,
};
