'use strict';

const { db } = require('../db/database');

function now() {
  return Date.now();
}

/** Simpan/replace daftar produk hasil sinkron dari Digiflazz */
function upsertProducts(list) {
  const stmt = db.prepare(
    `INSERT INTO products (buyer_sku_code, product_name, category, brand, type, price, desc, status, updated_at)
     VALUES (@buyer_sku_code, @product_name, @category, @brand, @type, @price, @desc, @status, @updated_at)
     ON CONFLICT(buyer_sku_code) DO UPDATE SET
       product_name = excluded.product_name,
       category = excluded.category,
       brand = excluded.brand,
       type = excluded.type,
       price = excluded.price,
       desc = excluded.desc,
       status = excluded.status,
       updated_at = excluded.updated_at`
  );
  const tx = db.transaction((rows) => {
    for (const p of rows) {
      stmt.run({
        buyer_sku_code: p.buyer_sku_code,
        product_name: p.product_name,
        category: p.category || 'Lainnya',
        brand: p.brand || '-',
        type: p.type || '-',
        price: Math.round(Number(p.price) || 0),
        desc: p.desc || null,
        status:
          p.buyer_product_status && p.seller_product_status ? 'active' : 'gangguan',
        updated_at: now(),
      });
    }
  });
  tx(list);
  return list.length;
}

function getCategories() {
  return db
    .prepare(
      `SELECT category, COUNT(*) AS c FROM products
        WHERE status = 'active' GROUP BY category ORDER BY category`
    )
    .all();
}

function getBrands(category) {
  return db
    .prepare(
      `SELECT brand, COUNT(*) AS c FROM products
        WHERE status = 'active' AND category = ? GROUP BY brand ORDER BY brand`
    )
    .all(category);
}

function getProductsByBrand(category, brand) {
  return db
    .prepare(
      `SELECT * FROM products
        WHERE status = 'active' AND category = ? AND brand = ?
        ORDER BY price ASC`
    )
    .all(category, brand);
}

function getProduct(sku) {
  return db.prepare('SELECT * FROM products WHERE buyer_sku_code = ?').get(sku);
}

function countProducts() {
  return db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
}

/** Hitung harga jual = harga modal + markup (delegasi ke markupService) */
function sellPrice(product, role) {
  // require lazy untuk menghindari siklus saat load awal
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
