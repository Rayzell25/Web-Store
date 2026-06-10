'use strict';

const pg = require('pg');
const { Pool } = pg;
const { config } = require('../config');
const logger = require('../utils/logger');

// BIGINT (OID 20) di-parse jadi Number JS (rupiah tidak akan melebihi MAX_SAFE_INTEGER).
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

const pool = config.databaseUrl
  ? new Pool({ connectionString: config.databaseUrl, max: 10 })
  : new Pool({
      host: config.pg.host,
      port: config.pg.port,
      user: config.pg.user,
      password: config.pg.password,
      database: config.pg.database,
      max: 10,
    });

pool.on('error', (e) => logger.error('Postgres pool error:', e.message));

/** Query mentah -> hasil pg (rows, rowCount, dll). */
function query(text, params) {
  return pool.query(text, params);
}

/** Ambil satu baris (atau null). */
async function one(text, params) {
  const r = await pool.query(text, params);
  return r.rows[0] || null;
}

/** Ambil semua baris. */
async function all(text, params) {
  const r = await pool.query(text, params);
  return r.rows;
}

/** Jalankan fn dalam 1 transaksi DB (atomik). fn menerima client. */
async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await fn(client);
    await client.query('COMMIT');
    return res;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          BIGINT PRIMARY KEY,
      username    TEXT,
      name        TEXT,
      balance     BIGINT NOT NULL DEFAULT 0,
      role        TEXT NOT NULL DEFAULT 'MEMBER',
      banned      BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  BIGINT NOT NULL,
      updated_at  BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      buyer_sku_code TEXT PRIMARY KEY,
      product_name   TEXT,
      category       TEXT,
      brand          TEXT,
      type           TEXT,
      price          BIGINT NOT NULL DEFAULT 0,
      "desc"         TEXT,
      status         TEXT DEFAULT 'active',
      updated_at     BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      ref_id         TEXT PRIMARY KEY,
      user_id        BIGINT NOT NULL,
      buyer_sku_code TEXT,
      product_name   TEXT,
      target         TEXT,
      cost_price     BIGINT NOT NULL DEFAULT 0,
      sell_price     BIGINT NOT NULL DEFAULT 0,
      status         TEXT NOT NULL DEFAULT 'Pending',
      sn             TEXT,
      message        TEXT,
      created_at     BIGINT NOT NULL,
      updated_at     BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS topups (
      id          BIGSERIAL PRIMARY KEY,
      user_id     BIGINT NOT NULL,
      amount      BIGINT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'Pending',
      note        TEXT,
      created_at  BIGINT NOT NULL,
      updated_at  BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    -- Hubungkan akun Google ke user (Telegram) id. 1 Google = 1 user.
    CREATE TABLE IF NOT EXISTS google_links (
      google_sub  TEXT PRIMARY KEY,         -- Google subject id (stabil per akun)
      user_id     BIGINT NOT NULL,          -- = users.id (Telegram id)
      email       TEXT,
      name        TEXT,
      created_at  BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS markups (
      sku        TEXT PRIMARY KEY,
      type       TEXT NOT NULL DEFAULT 'flat',
      value      DOUBLE PRECISION NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS qris_payments (
      transaction_id TEXT PRIMARY KEY,
      order_id       TEXT,
      user_id        BIGINT NOT NULL,
      chat_id        BIGINT NOT NULL,
      message_id     BIGINT,
      purpose        TEXT NOT NULL,                  -- 'order' | 'topup'
      base_amount    BIGINT NOT NULL,                -- harga produk / nominal topup
      fee            BIGINT NOT NULL DEFAULT 0,
      amount         BIGINT NOT NULL,                -- total dibayar (base+fee)
      payload        TEXT,                           -- JSON detail
      status         TEXT NOT NULL DEFAULT 'pending', -- pending|processing|done|expired|canceled|failed
      created_at     BIGINT NOT NULL,
      updated_at     BIGINT NOT NULL,
      expiry_at      BIGINT
    );

    -- banner per-produk (migrasi aman: tidak error jika kolom sudah ada)
    ALTER TABLE products ADD COLUMN IF NOT EXISTS banner_url TEXT;

    CREATE INDEX IF NOT EXISTS idx_trx_user ON transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_trx_created ON transactions(created_at);
    CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category);
    CREATE INDEX IF NOT EXISTS idx_topups_status ON topups(status);
    CREATE INDEX IF NOT EXISTS idx_qris_status ON qris_payments(status);
    CREATE INDEX IF NOT EXISTS idx_google_links_user ON google_links(user_id);
  `);
  logger.info('Database PostgreSQL siap.');
}

module.exports = { pool, query, one, all, withTx, init };
