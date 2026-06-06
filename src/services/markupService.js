'use strict';

const { one, all, query } = require('../db/database');
const { rupiah, LINE } = require('../utils/format');

const SETTINGS_KEY = 'markup_config';

const DEFAULT_CONFIG = {
  default: { type: 'flat', value: 500 },
  reseller: { type: 'flat', value: 250 },
  categories: {},
  round: 100,
};

// Cache in-memory supaya sellPrice() tetap sinkron (dipanggil dalam loop produk).
const cache = {
  config: { ...DEFAULT_CONFIG },
  overrides: new Map(), // sku -> { type, value }
};

function now() {
  return Date.now();
}

/** Muat konfigurasi markup dari DB ke cache. Dipanggil saat startup & tiap perubahan. */
async function load() {
  const row = await one('SELECT value FROM settings WHERE key = $1', [SETTINGS_KEY]);
  if (row && row.value) {
    try {
      const parsed = JSON.parse(row.value);
      cache.config = {
        default: parsed.default || DEFAULT_CONFIG.default,
        reseller: parsed.reseller || DEFAULT_CONFIG.reseller,
        categories: parsed.categories || {},
        round: typeof parsed.round === 'number' ? parsed.round : DEFAULT_CONFIG.round,
      };
    } catch (e) {
      cache.config = { ...DEFAULT_CONFIG };
    }
  } else {
    cache.config = { ...DEFAULT_CONFIG };
  }
  const rows = await all('SELECT * FROM markups');
  cache.overrides = new Map(
    rows.map((r) => [r.sku, { type: r.type, value: Number(r.value) }])
  );
}

function getConfig() {
  return cache.config;
}

async function saveConfig(cfg) {
  cache.config = cfg;
  await query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [SETTINGS_KEY, JSON.stringify(cfg)]
  );
  return cfg;
}

async function setRule(scope, type, value, category) {
  const cfg = { ...getConfig(), categories: { ...getConfig().categories } };
  const rule = { type: type === 'percent' ? 'percent' : 'flat', value: Number(value) };
  if (scope === 'default') cfg.default = rule;
  else if (scope === 'reseller') cfg.reseller = rule;
  else if (scope === 'category') cfg.categories[category] = rule;
  return saveConfig(cfg);
}

async function setRound(value) {
  const cfg = { ...getConfig() };
  cfg.round = Math.max(0, Number(value) || 0);
  return saveConfig(cfg);
}

async function deleteCategoryRule(category) {
  const cfg = { ...getConfig(), categories: { ...getConfig().categories } };
  delete cfg.categories[category];
  return saveConfig(cfg);
}

// ----- override per produk -----
async function setProductMarkup(sku, type, value) {
  const t = type === 'percent' ? 'percent' : 'flat';
  const v = Number(value);
  await query(
    `INSERT INTO markups (sku, type, value, updated_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (sku) DO UPDATE SET type = EXCLUDED.type, value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [sku, t, v, now()]
  );
  cache.overrides.set(sku, { type: t, value: v });
}

async function deleteProductMarkup(sku) {
  await query('DELETE FROM markups WHERE sku = $1', [sku]);
  cache.overrides.delete(sku);
}

function getProductMarkup(sku) {
  return cache.overrides.get(sku) || null;
}

/** Aturan markup yang berlaku: override produk > kategori > default role. */
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

/** Harga jual akhir (sinkron). */
function sellPrice(product, role) {
  const cfg = getConfig();
  const rule = resolveRule(product, role);
  const cost = Number(product.price) || 0;
  const markupAmount = rule.type === 'percent' ? (cost * rule.value) / 100 : rule.value;
  return applyRound(cost + markupAmount, cfg.round);
}

function describe() {
  const cfg = getConfig();
  const fmt = (r) => (r.type === 'percent' ? `${r.value}%` : rupiah(r.value));
  let text =
    `<b>KONFIGURASI MARKUP</b>\n` +
    `${LINE}\n` +
    `• Default (MEMBER): <b>${fmt(cfg.default)}</b>\n` +
    `• RESELLER: <b>${fmt(cfg.reseller)}</b>\n` +
    `• Pembulatan: ${cfg.round ? 'kelipatan ' + rupiah(cfg.round) : 'tidak ada'}\n`;
  const cats = Object.entries(cfg.categories);
  if (cats.length) {
    text += `\n<b>Per Kategori:</b>\n`;
    for (const [cat, r] of cats) text += `• ${cat}: ${fmt(r)}\n`;
  }
  const overrides = [...cache.overrides.entries()].slice(0, 15);
  if (overrides.length) {
    text += `\n<b>Override Produk (${cache.overrides.size}):</b>\n`;
    for (const [sku, r] of overrides) {
      text += `• ${sku}: ${r.type === 'percent' ? r.value + '%' : rupiah(r.value)}\n`;
    }
  }
  return text;
}

module.exports = {
  load,
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
