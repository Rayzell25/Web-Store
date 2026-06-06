'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { config } = require('../config');
const logger = require('../utils/logger');

const dbFile = path.resolve(process.cwd(), config.dbPath);
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY,            -- telegram id
      username      TEXT,
      name          TEXT,
      balance       INTEGER NOT NULL DEFAULT 0,
      role          TEXT NOT NULL DEFAULT 'MEMBER', -- MEMBER | RESELLER | ADMIN
      banned        INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      buyer_sku_code TEXT PRIMARY KEY,
      product_name   TEXT,
      category       TEXT,
      brand          TEXT,
      type           TEXT,
      price          INTEGER NOT NULL DEFAULT 0,   -- harga modal dari digiflazz
      desc           TEXT,
      status         TEXT DEFAULT 'active',         -- active | gangguan
      updated_at     INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      ref_id        TEXT PRIMARY KEY,
      user_id       INTEGER NOT NULL,
      buyer_sku_code TEXT,
      product_name  TEXT,
      target        TEXT,
      cost_price    INTEGER NOT NULL DEFAULT 0,    -- modal
      sell_price    INTEGER NOT NULL DEFAULT 0,    -- harga jual ke user
      status        TEXT NOT NULL DEFAULT 'Pending', -- Pending | Sukses | Gagal
      sn            TEXT,
      message       TEXT,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS topups (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL,
      amount        INTEGER NOT NULL,
      status        TEXT NOT NULL DEFAULT 'Pending', -- Pending | Approved | Rejected
      note          TEXT,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    -- override markup per produk (prioritas tertinggi)
    CREATE TABLE IF NOT EXISTS markups (
      sku        TEXT PRIMARY KEY,
      type       TEXT NOT NULL DEFAULT 'flat',  -- flat | percent
      value      REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_trx_user ON transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_trx_created ON transactions(created_at);
    CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category);
    CREATE INDEX IF NOT EXISTS idx_topups_status ON topups(status);
  `);
  logger.info(`Database siap di ${dbFile}`);
}

module.exports = { db, init };
