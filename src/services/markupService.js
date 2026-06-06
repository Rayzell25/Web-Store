'use strict';

const { db } = require('../db/database');
const { rupiah } = require('../utils/format');

const SETTINGS_KEY = 'markup_config';

const DEFAULT_CONFIG = {
  default: { type: 'flat', value: 500 },   // MEMBER
  reseller: { type: 'flat', value: 250 },  // RESELLER
  categories: {},                          // { "Pulsa": {type,value}, ... }
  round: 100,                              // pembulatan ke atas ke kelipatan ini (0 = tidak)
};

function now() {
  return Date.now();
}

function getConfig() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTINGS_KEY);
  if (!row) return { ...DEFAULT_CONFIG };
  try {
    const parsed = JSON.parse(row.value);
    return {
      default: parsed.default || DEFAULT_CONFIG.default,
      reseller: parsed.reseller || DEFAULT_CONFIG.reseller,
      categories: parsed.categories || {},
      round: typeof parsed.round === 'number' ? parsed.round : DEFAULT_CONFIG.round,
    };
  } catch (e) {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(cfg) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(SETTINGS_KEY, JSON.stringify(cfg));
  return cfg;
}

function setRule(scope, type, value, category) {
  const cfg = getConfig();
  const rule = { type: type === 'percent' ? 'percent' : 'flat', value: Number(value) };
  if (scope === 'default') cfg.default = rule;
  else if (scope === 'reseller') cfg.reseller = rule;
  else if (scope === 'category') cfg.categories[category] = rule;
  saveConfig(cfg);
  return cfg;
}

function setRound(value) {
  const cfg = getConfig();
  cfg.round = Math.max(0, Number(value) || 0);
  saveConfig(cfg);
  return cfg;
}

function deleteCategoryRule(category) {
  const cfg = getConfig();
  delete cfg.categories[category];
  saveConfig(cfg);
  return cfg;
}

// ----- override per produk -----
function setProductMarkup(sku, type, value) {
  db.prepare(
    `INSERT INTO markups (sku, type, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(sku) DO UPDATE SET type = excluded.type, value = excluded.value, updated_at = excluded.updated_at`
  ).run(sku, type === 'percent' ? 'percent' : 'flat', Number(value), now());
}

function deleteProductMarkup(sku) {
  db.prepare('DELETE FROM markups WHERE sku = ?').run(sku);
}

function getProductMarkup(sku) {
  return db.prepare('SELECT * FROM markups WHERE sku = ?').get(sku);
}

/**
 * Tentukan aturan markup yang berlaku untuk sebuah produk + role.
 * Prioritas: override produk > markup kategori > default role.
 */
function resolveRule(product, role) {
  const cfg = getConfig();
  const override = getProductMarkup(product.buyer_sku_code);
  if (override) return { type: override.type, value: override.value, source: 'produk' };

  const catRule = product.category && cfg.categories[product.category];
  if (catRule) return { ...catRule, source: 'kategori' };

  if (role === 'RESELLER') return { ...cfg.reseller, source: 'reseller' };
  return { ...cfg.default, source: 'default' };
}

function applyRound(price, round) {
  if (!round || round <= 0) return Math.round(price);
  return Math.ceil(price / round) * round;
}

/** Hitung harga jual akhir untuk produk + role. */
function sellPrice(product, role) {
  const cfg = getConfig();
  const rule = resolveRule(product, role);
  const cost = Number(product.price) || 0;
  const markupAmount = rule.type === 'percent' ? (cost * rule.value) / 100 : rule.value;
  return applyRound(cost + markupAmount, cfg.round);
}

/** Ringkasan konfigurasi untuk ditampilkan ke admin. */
function describe() {
  const cfg = getConfig();
  const fmt = (r) => (r.type === 'percent' ? `${r.value}%` : rupiah(r.value));
  let text =
    `🏷 <b>KONFIGURASI MARKUP</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `• Default (MEMBER): <b>${fmt(cfg.default)}</b>\n` +
    `• RESELLER: <b>${fmt(cfg.reseller)}</b>\n` +
    `• Pembulatan: ${cfg.round ? 'kelipatan ' + rupiah(cfg.round) : 'tidak ada'}\n`;
  const cats = Object.entries(cfg.categories);
  if (cats.length) {
    text += `\n<b>Per Kategori:</b>\n`;
    for (const [cat, r] of cats) text += `• ${cat}: ${fmt(r)}\n`;
  }
  const overrides = db.prepare('SELECT * FROM markups ORDER BY updated_at DESC LIMIT 15').all();
  if (overrides.length) {
    text += `\n<b>Override Produk (${overrides.length}):</b>\n`;
    for (const o of overrides) {
      text += `• ${o.sku}: ${o.type === 'percent' ? o.value + '%' : rupiah(o.value)}\n`;
    }
  }
  return text;
}

module.exports = {
  getConfig,
  saveConfig,
  setRule,
  setRound,
  deleteCategoryRule,
  setProductMarkup,
  deleteProductMarkup,
  getProductMarkup,
  resolveRule,
  sellPrice,
  describe,
};
