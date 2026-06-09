'use strict';

const { isAdmin } = require('../config');
const userService = require('../services/userService');
const trxService = require('../services/trxService');
const depositService = require('../services/depositService');
const productService = require('../services/productService');
const markupService = require('../services/markupService');
const digiflazz = require('../services/digiflazz');
const { setState, clearState, getState } = require('../utils/session');
const { rupiah, escapeHtml, tanggal, truncate, LINE } = require('../utils/format');
const { editOrSend: edit } = require('../utils/ui');
const { tokenFor, valueOf } = require('../utils/registry');
const { gridKeyboard } = require('../keyboards/menus');
const logger = require('../utils/logger');

function adminMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: 'STATISTIK', callback_data: 'adm:stats' }],
      [{ text: 'TOP UP PENDING', callback_data: 'adm:deposits' }],
      [
        { text: 'SALDO MANUAL', callback_data: 'adm:addsaldo' },
        { text: 'SET ROLE', callback_data: 'adm:setrole' },
      ],
      [
        { text: 'MARKUP', callback_data: 'adm:markup' },
        { text: 'SYNC PRODUK', callback_data: 'adm:sync' },
      ],
      [
        { text: 'SET FOTO SAMBUTAN', callback_data: 'adm:setfoto' },
        { text: 'HAPUS FOTO', callback_data: 'adm:delfoto' },
      ],
      [{ text: 'BROADCAST', callback_data: 'adm:broadcast' }],
      [{ text: '« KEMBALI', callback_data: 'menu:home' }],
    ],
  };
}

async function showAdminMenu(bot, chatId, messageId, from) {
  if (!isAdmin(from.id)) return;
  const text = `<b>PANEL ADMIN</b>\n${LINE}\nPilih menu pengelolaan:`;
  await edit(bot, chatId, messageId, text, adminMenuKeyboard());
}

async function showStats(bot, chatId, messageId) {
  let deposit = null;
  try {
    deposit = await digiflazz.checkDeposit();
  } catch (e) {
    logger.warn('Cek deposit gagal:', e.message);
  }
  const [cu, ct, tr, cp] = await Promise.all([
    userService.countUsers(),
    trxService.countTransactions(),
    trxService.todayRevenue(),
    productService.countProducts(),
  ]);
  const stat =
    `Pengguna  : ${cu}\n` +
    `Transaksi : ${ct}\n` +
    `Omzet ini : ${rupiah(tr)}\n` +
    `Produk    : ${cp}\n` +
    `Digiflazz : ${deposit != null ? rupiah(deposit) : '(gagal cek)'}`;
  const text = `<b>STATISTIK</b>\n${LINE}\n<code>${escapeHtml(stat)}</code>`;
  await edit(bot, chatId, messageId, text, back('menu:admin'));
}

async function showPendingDeposits(bot, chatId, messageId) {
  const list = await depositService.pendingDeposits(20);
  if (!list.length) {
    return edit(bot, chatId, messageId, '🧾 Tidak ada top up pending.', back('menu:admin'));
  }
  let text = `<b>TOP UP PENDING</b>\n${LINE}\n`;
  const rows = [];
  for (const t of list) {
    const u = await userService.getUser(t.user_id);
    text += `#${t.id} · ${escapeHtml(u ? u.name : t.user_id)} · ${rupiah(t.amount)} · ${tanggal(t.created_at)}\n`;
    rows.push([
      { text: `SETUJUI #${t.id}`, callback_data: `dp:ok:${t.id}` },
      { text: `TOLAK #${t.id}`, callback_data: `dp:no:${t.id}` },
    ]);
  }
  rows.push([{ text: '« KEMBALI', callback_data: 'menu:admin' }]);
  await edit(bot, chatId, messageId, text, { inline_keyboard: rows });
}

async function askAddSaldo(bot, chatId, messageId, userId) {
  await setState(userId, 'adm:addsaldo', {});
  await edit(bot, chatId, messageId,
    `<b>SALDO MANUAL</b>\n${LINE}\nKetik: <code>ID_TELEGRAM NOMINAL</code>\nContoh: <code>123456789 50000</code>\n(Nominal boleh negatif untuk mengurangi)`,
    back('menu:admin'));
}

async function askSetRole(bot, chatId, messageId, userId) {
  await setState(userId, 'adm:setrole', {});
  await edit(bot, chatId, messageId,
    `<b>SET ROLE</b>\n${LINE}\nKetik: <code>ID_TELEGRAM ROLE</code>\nROLE: MEMBER / RESELLER / ADMIN\nContoh: <code>123456789 RESELLER</code>`,
    back('menu:admin'));
}

async function askBroadcast(bot, chatId, messageId, userId) {
  await setState(userId, 'adm:broadcast', {});
  await edit(bot, chatId, messageId,
    `<b>BROADCAST</b>\n${LINE}\nKetik pesan yang ingin dikirim ke semua pengguna:`,
    back('menu:admin'));
}

// ===== MARKUP / KEUNTUNGAN (berbasis tombol) =====

/** Format aturan markup jadi teks ramah. */
function fmtRule(r) {
  if (!r) return '-';
  return r.type === 'percent' ? `${r.value}%` : rupiah(r.value);
}

/** Keyboard pilih tipe markup (flat/percent) + tombol opsional + kembali. */
function typeKb(prefix, backData, extraRows) {
  return {
    inline_keyboard: [
      [
        { text: 'FLAT (Rp)', callback_data: `${prefix}:flat` },
        { text: 'PERSEN (%)', callback_data: `${prefix}:percent` },
      ],
      ...(Array.isArray(extraRows) ? extraRows : []),
      [{ text: '« KEMBALI', callback_data: backData }],
    ],
  };
}

/** Teks instruksi minta angka keuntungan. */
function askValueText(label, type) {
  const ex = type === 'percent' ? '3  →  3% dari modal' : '1000  →  Rp 1.000';
  return (
    `<b>SET KEUNTUNGAN</b>\n${LINE}\n` +
    `Target : <b>${escapeHtml(label)}</b>\n` +
    `Tipe   : <b>${type === 'percent' ? 'Persen (%)' : 'Flat (Rp)'}</b>\n\n` +
    `Ketik <b>angka</b> keuntungannya.\nContoh: <code>${ex}</code>`
  );
}

/** Menu utama MARKUP (tombol). */
async function showMarkup(bot, chatId, messageId, userId) {
  await clearState(userId);
  const kb = {
    inline_keyboard: [
      [{ text: 'KEUNTUNGAN SEMUA (MEMBER)', callback_data: 'adm:mk:scope:default' }],
      [{ text: 'KEUNTUNGAN RESELLER', callback_data: 'adm:mk:scope:reseller' }],
      [
        { text: 'PER KATEGORI', callback_data: 'adm:mk:cats' },
        { text: 'PER PRODUK', callback_data: 'adm:mk:pcats' },
      ],
      [{ text: 'PEMBULATAN HARGA', callback_data: 'adm:mk:round' }],
      [{ text: '« KEMBALI', callback_data: 'menu:admin' }],
    ],
  };
  await edit(bot, chatId, messageId,
    `${markupService.describe()}\n${LINE}\nPilih yang mau diatur:`, kb);
}

/** Daftar kategori untuk markup per-kategori. */
async function showMarkupCats(bot, chatId, messageId) {
  const cats = await productService.getCategories();
  if (!cats.length) {
    return edit(bot, chatId, messageId,
      '⚠️ Belum ada produk. Jalankan Sync Produk dulu.', back('adm:markup'));
  }
  const items = cats.map((c) => ({
    text: `${truncate(c.category, 20)} (${c.c})`,
    data: `adm:mk:cat:${tokenFor(c.category)}`,
  }));
  await edit(bot, chatId, messageId,
    `<b>MARKUP PER KATEGORI</b>\n${LINE}\nPilih kategori:`,
    gridKeyboard(items, 2, 'adm:markup'));
}

/** Detail 1 kategori: pilih tipe / hapus. */
async function showMarkupCat(bot, chatId, messageId, catToken) {
  const category = valueOf(catToken);
  if (!category) return showMarkupCats(bot, chatId, messageId);
  const cur = markupService.getConfig().categories[category];
  const extra = cur
    ? [[{ text: 'HAPUS MARKUP KATEGORI', callback_data: `adm:mk:cdel:${catToken}` }]]
    : [];
  await edit(bot, chatId, messageId,
    `<b>KATEGORI: ${escapeHtml(category)}</b>\n${LINE}\n` +
    `Markup sekarang: <b>${cur ? fmtRule(cur) : '(ikut default)'}</b>\n\nPilih tipe markup:`,
    typeKb(`adm:mk:ctype:${catToken}`, 'adm:mk:cats', extra));
}

/** Daftar kategori untuk markup per-produk. */
async function showMarkupProdCats(bot, chatId, messageId) {
  const cats = await productService.getCategories();
  if (!cats.length) {
    return edit(bot, chatId, messageId,
      '⚠️ Belum ada produk. Jalankan Sync Produk dulu.', back('adm:markup'));
  }
  const items = cats.map((c) => ({
    text: `${truncate(c.category, 20)} (${c.c})`,
    data: `adm:mk:pcat:${tokenFor(c.category)}`,
  }));
  await edit(bot, chatId, messageId,
    `<b>MARKUP PER PRODUK</b>\n${LINE}\nPilih kategori:`,
    gridKeyboard(items, 2, 'adm:markup'));
}

/** Daftar brand pada kategori (untuk per-produk). */
async function showMarkupProdBrands(bot, chatId, messageId, catToken) {
  const category = valueOf(catToken);
  if (!category) return showMarkupProdCats(bot, chatId, messageId);
  const brands = await productService.getBrands(category);
  const items = brands.map((b) => ({
    text: `${truncate(b.brand, 22)} (${b.c})`,
    data: `adm:mk:pbrand:${catToken}:${tokenFor(b.brand)}`,
  }));
  await edit(bot, chatId, messageId,
    `<b>${escapeHtml(category.toUpperCase())}</b>\n${LINE}\nPilih brand:`,
    gridKeyboard(items, 2, 'adm:mk:pcats'));
}

/** Daftar produk pada brand (untuk per-produk). */
async function showMarkupProdList(bot, chatId, messageId, catToken, brandToken) {
  const category = valueOf(catToken);
  const brand = valueOf(brandToken);
  if (!category || !brand) return showMarkupProdCats(bot, chatId, messageId);
  const products = await productService.getProductsByBrand(category, brand);
  const items = products.map((p) => {
    const ov = markupService.getProductMarkup(p.buyer_sku_code);
    const tag = ov ? ` [${fmtRule(ov)}]` : '';
    return {
      text: `${truncate(p.product_name, 26)}${tag}`,
      data: `adm:mk:prod:${p.buyer_sku_code}`,
    };
  });
  await edit(bot, chatId, messageId,
    `<b>${escapeHtml(brand.toUpperCase())}</b> · ${escapeHtml(category)}\n${LINE}\n` +
    `Pilih produk untuk set markup khusus:`,
    gridKeyboard(items, 1, `adm:mk:pcat:${catToken}`));
}

/** Detail 1 produk: pilih tipe / hapus override. */
async function showMarkupProd(bot, chatId, messageId, sku) {
  const product = await productService.getProduct(sku);
  if (!product) return showMarkupProdCats(bot, chatId, messageId);
  const cur = markupService.getProductMarkup(sku);
  const extra = cur
    ? [[{ text: 'HAPUS MARKUP PRODUK', callback_data: `adm:mk:pdel:${sku}` }]]
    : [];
  const info =
    `${product.product_name}\n` +
    `Modal: ${rupiah(product.price)}`;
  await edit(bot, chatId, messageId,
    `<b>MARKUP PRODUK</b>\n${LINE}\n<code>${escapeHtml(info)}</code>\n` +
    `Markup sekarang: <b>${cur ? fmtRule(cur) : '(ikut kategori/default)'}</b>\n\nPilih tipe markup:`,
    typeKb(`adm:mk:ptype:${sku}`, 'adm:mk:pcats', extra));
}

/**
 * Router callback markup (semua data berawalan 'adm:mk:').
 * Dipanggil dari main.js (sudah dijaga isAdmin).
 */
async function handleMarkupCallback(bot, chatId, messageId, from, data) {
  const userId = from.id;
  const seg = data.split(':'); // ['adm','mk', action, ...]
  const action = seg[2];

  // --- global: default / reseller ---
  if (action === 'scope') {
    const scope = seg[3] === 'reseller' ? 'reseller' : 'default';
    const label = scope === 'reseller' ? 'RESELLER' : 'Semua produk (MEMBER)';
    return edit(bot, chatId, messageId,
      `<b>SET KEUNTUNGAN — ${escapeHtml(label)}</b>\n${LINE}\n` +
      `Sekarang: <b>${fmtRule(markupService.getConfig()[scope])}</b>\n\nPilih tipe markup:`,
      typeKb(`adm:mk:t:${scope}`, 'adm:markup'));
  }
  if (action === 't') {
    const scope = seg[3] === 'reseller' ? 'reseller' : 'default';
    const type = seg[4] === 'percent' ? 'percent' : 'flat';
    const label = scope === 'reseller' ? 'RESELLER' : 'Semua produk (MEMBER)';
    await setState(userId, 'adm:mk:input', { scope, type, label });
    return edit(bot, chatId, messageId, askValueText(label, type), back('adm:markup'));
  }

  // --- per kategori ---
  if (action === 'cats') return showMarkupCats(bot, chatId, messageId);
  if (action === 'cat') return showMarkupCat(bot, chatId, messageId, seg[3]);
  if (action === 'ctype') {
    const catToken = seg[3];
    const type = seg[4] === 'percent' ? 'percent' : 'flat';
    const category = valueOf(catToken);
    if (!category) return showMarkupCats(bot, chatId, messageId);
    await setState(userId, 'adm:mk:input', { scope: 'category', category, type, label: `Kategori ${category}` });
    return edit(bot, chatId, messageId, askValueText(`Kategori "${category}"`, type), back(`adm:mk:cat:${catToken}`));
  }
  if (action === 'cdel') {
    const category = valueOf(seg[3]);
    if (category) await markupService.deleteCategoryRule(category);
    return edit(bot, chatId, messageId,
      `✅ Markup kategori "${escapeHtml(category || '-')}" dihapus.`, back('adm:mk:cats'));
  }

  // --- per produk (navigasi kategori -> brand -> produk) ---
  if (action === 'pcats') return showMarkupProdCats(bot, chatId, messageId);
  if (action === 'pcat') return showMarkupProdBrands(bot, chatId, messageId, seg[3]);
  if (action === 'pbrand') return showMarkupProdList(bot, chatId, messageId, seg[3], seg[4]);
  if (action === 'prod') return showMarkupProd(bot, chatId, messageId, seg.slice(3).join(':'));
  if (action === 'ptype') {
    const type = seg[seg.length - 1] === 'percent' ? 'percent' : 'flat';
    const sku = seg.slice(3, seg.length - 1).join(':');
    const product = await productService.getProduct(sku);
    if (!product) return showMarkupProdCats(bot, chatId, messageId);
    await setState(userId, 'adm:mk:input', { scope: 'product', sku, type, label: product.product_name });
    return edit(bot, chatId, messageId, askValueText(product.product_name, type), back(`adm:mk:prod:${sku}`));
  }
  if (action === 'pdel') {
    const sku = seg.slice(3).join(':');
    await markupService.deleteProductMarkup(sku);
    return edit(bot, chatId, messageId, '✅ Markup produk dihapus.', back('adm:mk:pcats'));
  }

  // --- pembulatan ---
  if (action === 'round') {
    await setState(userId, 'adm:mk:input', { scope: 'round', label: 'Pembulatan harga' });
    return edit(bot, chatId, messageId,
      `<b>PEMBULATAN HARGA</b>\n${LINE}\n` +
      `Sekarang: <b>${markupService.getConfig().round ? 'kelipatan ' + rupiah(markupService.getConfig().round) : 'tidak ada'}</b>\n\n` +
      `Ketik kelipatan pembulatan (0 = tidak dibulatkan).\nContoh: <code>100</code> → harga dibulatkan ke atas kelipatan 100.`,
      back('adm:markup'));
  }

  // tidak dikenali -> kembali ke menu markup
  return showMarkup(bot, chatId, messageId, userId);
}

async function syncProducts(bot, chatId, messageId) {
  await edit(bot, chatId, messageId, '🔄 Mengambil daftar produk dari Digiflazz...', null);
  try {
    const list = await digiflazz.priceList();
    const n = await productService.upsertProducts(list);
    const total = await productService.countProducts();
    await edit(bot, chatId, messageId,
      `✅ Sync selesai. ${n} produk diperbarui.\nTotal produk: ${total}`,
      back('menu:admin'));
  } catch (e) {
    logger.error('Sync produk gagal:', e.message);
    const low = String(e.message || '').toLowerCase();
    const hint = low.includes('limit')
      ? 'Kena batas pengecekan pricelist Digiflazz. Tunggu ~2-5 menit, lalu Sync SEKALI lagi (jangan sync berulang-ulang). Username & API Key kamu sudah benar.'
      : 'Pastikan DIGIFLAZZ_USERNAME & DIGIFLAZZ_API_KEY benar.';
    await edit(bot, chatId, messageId,
      `❌ Sync gagal: ${escapeHtml(e.message)}\n\n${hint}`,
      back('menu:admin'));
  }
}

async function showSetFoto(bot, chatId, messageId, userId) {
  await require('../utils/session').setState(userId, 'adm:set_foto', {});
  await edit(bot, chatId, messageId,
    `<b>SET FOTO SAMBUTAN</b>\n${require('../utils/format').LINE}\nKirim foto/gambar yang ingin ditampilkan di atas pesan /start.\n\nTips: gunakan foto landscape/banner agar terlihat proporsional.`,
    back('menu:admin'));
}

async function deleteFoto(bot, chatId, messageId) {
  const { query } = require('../db/database');
  await query("DELETE FROM settings WHERE key = 'banner_photo'");
  await edit(bot, chatId, messageId, '✅ Foto sambutan dihapus.', back('menu:admin'));
}

/** Tangani input teks admin sesuai state. Return true jika ditangani. */
async function handleAdminText(bot, chatId, from, text, broadcastFn) {
  const state = await getState(from.id);
  if (!state || !isAdmin(from.id)) return false;

  if (state.action === 'adm:addsaldo') {
    await clearState(from.id);
    const m = String(text).trim().split(/\s+/);
    const targetId = Number(m[0]);
    const amount = parseInt(m[1], 10);
    if (!Number.isFinite(targetId) || !Number.isFinite(amount)) {
      await bot.sendMessage(chatId, '⚠️ Format salah. Contoh: 123456789 50000');
      return true;
    }
    if (!(await userService.getUser(targetId))) {
      await bot.sendMessage(chatId, '⚠️ User belum terdaftar (harus /start dulu).');
      return true;
    }
    try {
      const newBal = await userService.addBalance(targetId, amount);
      await bot.sendMessage(chatId, `✅ Saldo ${targetId} kini ${rupiah(newBal)} (${amount >= 0 ? '+' : ''}${rupiah(amount)}).`);
      try {
        await bot.sendMessage(targetId,
          `💳 Saldo kamu disesuaikan admin: ${amount >= 0 ? '+' : ''}${rupiah(amount)}\nSaldo sekarang: ${rupiah(newBal)}`);
      } catch (e) { /* ignore */ }
    } catch (e) {
      await bot.sendMessage(chatId, `⚠️ ${e.message}`);
    }
    return true;
  }

  if (state.action === 'adm:setrole') {
    await clearState(from.id);
    const m = String(text).trim().split(/\s+/);
    const targetId = Number(m[0]);
    const role = String(m[1] || '').toUpperCase();
    if (!Number.isFinite(targetId) || !['MEMBER', 'RESELLER', 'ADMIN'].includes(role)) {
      await bot.sendMessage(chatId, '⚠️ Format salah. Contoh: 123456789 RESELLER');
      return true;
    }
    if (!(await userService.getUser(targetId))) {
      await bot.sendMessage(chatId, '⚠️ User belum terdaftar (harus /start dulu).');
      return true;
    }
    await userService.setRole(targetId, role);
    await bot.sendMessage(chatId, `✅ Role ${targetId} diubah menjadi ${role}.`);
    return true;
  }

  if (state.action === 'adm:mk:input') {
    await clearState(from.id);
    const { scope, type, category, sku, label } = state.data || {};
    // ambil angka dari teks (toleran: "Rp 1.000" / "1000" / "3,5")
    const raw = String(text).replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
    const num = Number(raw);
    if (!/\d/.test(raw) || !Number.isFinite(num) || num < 0) {
      await bot.sendMessage(chatId, '⚠️ Angka tidak valid. Buka menu MARKUP lagi lalu ulangi.', { parse_mode: 'HTML' });
      return true;
    }
    try {
      if (scope === 'round') {
        await markupService.setRound(num);
        await bot.sendMessage(chatId,
          `✅ Pembulatan di-set ke <b>${num > 0 ? 'kelipatan ' + rupiah(num) : 'tidak ada'}</b>.`,
          { parse_mode: 'HTML' });
      } else if (scope === 'default' || scope === 'reseller') {
        await markupService.setRule(scope, type, num);
        await bot.sendMessage(chatId,
          `✅ Keuntungan <b>${escapeHtml(label || scope)}</b> di-set ke <b>${type === 'percent' ? num + '%' : rupiah(num)}</b>.`,
          { parse_mode: 'HTML' });
      } else if (scope === 'category') {
        await markupService.setRule('category', type, num, category);
        await bot.sendMessage(chatId,
          `✅ Keuntungan <b>${escapeHtml(label || category)}</b> di-set ke <b>${type === 'percent' ? num + '%' : rupiah(num)}</b>.`,
          { parse_mode: 'HTML' });
      } else if (scope === 'product') {
        await markupService.setProductMarkup(sku, type, num);
        await bot.sendMessage(chatId,
          `✅ Keuntungan produk <b>${escapeHtml(label || sku)}</b> di-set ke <b>${type === 'percent' ? num + '%' : rupiah(num)}</b>.`,
          { parse_mode: 'HTML' });
      } else {
        await bot.sendMessage(chatId, '⚠️ Sesi markup tidak dikenali. Buka menu MARKUP lagi.');
      }
    } catch (e) {
      await bot.sendMessage(chatId, `⚠️ Gagal: ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
    }
    return true;
  }

  if (state.action === 'adm:broadcast') {
    await clearState(from.id);
    await bot.sendMessage(chatId, '📢 Memulai broadcast...');
    const result = await broadcastFn(text);
    await bot.sendMessage(chatId, `✅ Broadcast selesai. Terkirim: ${result.sent}, Gagal: ${result.failed}.`);
    return true;
  }

  return false;
}

function back(target) {
  return { inline_keyboard: [[{ text: '« KEMBALI', callback_data: target }]] };
}

module.exports = {
  showAdminMenu,
  showStats,
  showPendingDeposits,
  askAddSaldo,
  askSetRole,
  askBroadcast,
  showMarkup,
  handleMarkupCallback,
  syncProducts,
  showSetFoto,
  deleteFoto,
  handleAdminText,
};
