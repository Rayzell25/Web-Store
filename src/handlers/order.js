'use strict';

const {
  getCategories,
  getBrands,
  getProductsByBrand,
  getProduct,
  sellPrice,
} = require('../services/productService');
const { getUser, addBalance } = require('../services/userService');
const { createTransaction, updateTransaction } = require('../services/trxService');
const digiflazz = require('../services/digiflazz');
const autogopay = require('../services/autogopay');
const qrisService = require('../services/qrisService');
const { config } = require('../config');
const { tokenFor, valueOf } = require('../utils/registry');
const { setState, clearState, getState } = require('../utils/session');
const { gridKeyboard, backButton } = require('../keyboards/menus');
const { rupiah, escapeHtml, trxCode, truncate, LINE } = require('../utils/format');
const logger = require('../utils/logger');

async function showCategories(bot, chatId, messageId) {
  const cats = await getCategories();
  if (!cats.length) {
    return editOrSend(bot, chatId, messageId,
      '⚠️ Produk belum tersedia.\n\nAdmin perlu menjalankan <b>Sync Produk</b> dari menu Admin terlebih dahulu.',
      backButton('menu:home'));
  }
  const items = cats.map((c) => ({
    text: `${truncate(c.category, 22)} (${c.c})`,
    data: `order:cat:${tokenFor(c.category)}`,
  }));
  await editOrSend(bot, chatId, messageId,
    `<b>BELI PAKET</b>\n${LINE}\nPilih kategori produk:`,
    gridKeyboard(items, 2, 'menu:home'));
}

async function showBrands(bot, chatId, messageId, catToken) {
  const category = valueOf(catToken);
  if (!category) return showCategories(bot, chatId, messageId);
  const brands = await getBrands(category);
  const items = brands.map((b) => ({
    text: `${truncate(b.brand, 22)} (${b.c})`,
    data: `order:brand:${catToken}:${tokenFor(b.brand)}`,
  }));
  await editOrSend(bot, chatId, messageId,
    `<b>${escapeHtml(category.toUpperCase())}</b>\n${LINE}\nPilih operator / brand:`,
    gridKeyboard(items, 2, 'menu:order'));
}

async function showProducts(bot, chatId, messageId, catToken, brandToken, userId) {
  const category = valueOf(catToken);
  const brand = valueOf(brandToken);
  if (!category || !brand) return showCategories(bot, chatId, messageId);

  const user = await getUser(userId);
  const products = await getProductsByBrand(category, brand);
  const items = products.map((p) => {
    const harga = sellPrice(p, user.role);
    return {
      text: `${truncate(p.product_name, 24)} • ${rupiah(harga)}`,
      data: `order:prod:${p.buyer_sku_code}`,
    };
  });
  await editOrSend(bot, chatId, messageId,
    `<b>${escapeHtml(brand.toUpperCase())}</b> · ${escapeHtml(category)}\n${LINE}\nPilih produk:`,
    gridKeyboard(items, 1, `order:cat:${catToken}`));
}

async function selectProduct(bot, chatId, messageId, sku, userId) {
  const product = await getProduct(sku);
  if (!product) {
    return editOrSend(bot, chatId, messageId, '⚠️ Produk tidak ditemukan.', backButton('menu:order'));
  }
  const user = await getUser(userId);
  const harga = sellPrice(product, user.role);

  await setState(userId, 'order:input_target', { sku });

  const detail =
    `Produk : ${product.product_name}\n` +
    `Brand  : ${product.brand}\n` +
    `Harga  : ${rupiah(harga)}` +
    (product.desc ? `\nKet.   : ${product.desc}` : '');

  const text =
    `<b>DETAIL PRODUK</b>\n` +
    `${LINE}\n` +
    `<code>${escapeHtml(detail)}</code>\n` +
    `${LINE}\n` +
    `Ketik <b>nomor tujuan</b> (HP / ID / No. pelanggan) di bawah.`;

  await editOrSend(bot, chatId, messageId, text, backButton('menu:order'));
}

async function receiveTarget(bot, chatId, userId, target) {
  const state = await getState(userId);
  if (!state || state.action !== 'order:input_target') return;
  const product = await getProduct(state.data.sku);
  if (!product) {
    await clearState(userId);
    return bot.sendMessage(chatId, '⚠️ Produk sudah tidak tersedia.', { parse_mode: 'HTML' });
  }
  const user = await getUser(userId);
  const harga = sellPrice(product, user.role);
  const cleanTarget = String(target).trim();

  await setState(userId, 'order:confirm', { sku: product.buyer_sku_code, target: cleanTarget });

  const detail =
    `Paket : ${product.product_name}\n` +
    `Nomor : ${cleanTarget}\n` +
    `Total : ${rupiah(harga)}`;

  const rows = [];
  const methodRow = [];
  if (config.qris.enabled) {
    methodRow.push({ text: 'QRIS', callback_data: 'order:pay:qris' });
  }
  methodRow.push({ text: 'SALDO', callback_data: 'order:pay:saldo' });
  rows.push(methodRow);
  rows.push([{ text: 'Batal', callback_data: 'menu:order' }]);

  let qrisLine = '';
  if (config.qris.enabled) {
    const { total } = autogopay.computeTotal(harga);
    qrisLine = `\nVia QRIS dibayar ${rupiah(total)}.`;
  }

  const text =
    `<b>PILIH PEMBAYARAN</b>\n` +
    `${LINE}\n` +
    `<code>${escapeHtml(detail)}</code>\n` +
    `${LINE}\n` +
    `Saldo kamu: ${rupiah(user.balance)}${qrisLine}\n\n` +
    `Pilih metode pembayaran:`;

  await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } });
}

async function pay(bot, chatId, messageId, userId, notifyAdmins, alert) {
  const state = await getState(userId);
  if (!state || state.action !== 'order:confirm') {
    if (typeof alert === 'function') return alert('Sesi pembelian kedaluwarsa. Ulangi dari menu Beli Paket.');
    return editOrSend(bot, chatId, messageId, '⚠️ Sesi pembelian kedaluwarsa. Ulangi dari menu Beli Paket.', backButton('menu:order'));
  }
  const { sku, target } = state.data;
  const product = await getProduct(sku);
  const user = await getUser(userId);
  if (!product) {
    await clearState(userId);
    return editOrSend(bot, chatId, messageId, '⚠️ Produk tidak tersedia.', backButton('menu:order'));
  }
  const harga = sellPrice(product, user.role);
  if (user.balance < harga) {
    // popup alert (tanpa kirim chat). State dibiarkan supaya bisa pilih QRIS.
    if (typeof alert === 'function') {
      return alert(`Saldo tidak cukup. Kurang ${rupiah(harga - user.balance)}.`);
    }
    return editOrSend(bot, chatId, messageId,
      `⚠️ Saldo tidak cukup. Kurang ${rupiah(harga - user.balance)}.`, backButton('menu:deposit'));
  }

  const refId = trxCode('CHO');

  try {
    await addBalance(userId, -harga); // potong dulu, refund jika gagal
  } catch (e) {
    await clearState(userId);
    if (typeof alert === 'function') return alert(e.message);
    return editOrSend(bot, chatId, messageId, `⚠️ ${e.message}`, backButton('menu:deposit'));
  }
  await clearState(userId);

  await createTransaction({
    ref_id: refId,
    user_id: userId,
    buyer_sku_code: sku,
    product_name: product.product_name,
    target,
    cost_price: product.price,
    sell_price: harga,
    status: 'Pending',
  });

  await editOrSend(bot, chatId, messageId, `⏳ Memproses transaksi <code>${refId}</code> ...`, null);

  let result;
  try {
    result = await digiflazz.topUp({ buyerSkuCode: sku, customerNo: target, refId });
  } catch (e) {
    logger.error('Digiflazz topUp error:', e.message);
    await addBalance(userId, harga);
    await updateTransaction(refId, { status: 'Gagal', message: 'Gagal terhubung ke provider' });
    return editOrSend(bot, chatId, messageId,
      `<b>TRANSAKSI GAGAL</b> ❌\n${LINE}\nGagal menghubungi provider. Saldo dikembalikan.\nRef: <code>${refId}</code>`,
      backButton('menu:home'));
  }

  const status = digiflazz.mapStatus(result.status);
  const sn = result.sn || null;
  const message = result.message || '';

  if (status === 'Gagal') {
    await addBalance(userId, harga);
    await updateTransaction(refId, { status: 'Gagal', message, sn });
    return editOrSend(bot, chatId, messageId,
      `<b>TRANSAKSI GAGAL</b> ❌\n${LINE}\n${escapeHtml(message)}\nSaldo dikembalikan.\nRef: <code>${refId}</code>`,
      backButton('menu:home'));
  }

  await updateTransaction(refId, { status, message, sn });
  const updatedUser = await getUser(userId);

  const statusIcon = status === 'Sukses' ? '✅' : '⏳';
  const detail =
    `Produk : ${product.product_name}\n` +
    `Tujuan : ${target}\n` +
    `Harga  : ${rupiah(harga)}\n` +
    (sn ? `SN     : ${sn}\n` : '') +
    `Ref    : ${refId}\n` +
    `Sisa   : ${rupiah(updatedUser.balance)}`;
  const text =
    `<b>TRANSAKSI ${status.toUpperCase()}</b> ${statusIcon}\n` +
    `${LINE}\n` +
    `<code>${escapeHtml(detail)}</code>` +
    (message ? `\n${escapeHtml(message)}` : '');

  await editOrSend(bot, chatId, messageId, text, backButton('menu:home'));

  if (typeof notifyAdmins === 'function') {
    notifyAdmins(
      `🔔 Transaksi ${status}\nUser: ${user.name} (${userId})\n${product.product_name} → ${target}\nHarga: ${rupiah(harga)} | Ref: ${refId}`
    );
  }
}

async function editOrSend(bot, chatId, messageId, text, replyMarkup) {
  const opts = { parse_mode: 'HTML' };
  if (replyMarkup) opts.reply_markup = replyMarkup;
  if (messageId) {
    try {
      return await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts });
    } catch (e) { /* fall through */ }
  }
  return bot.sendMessage(chatId, text, opts);
}

/** Bayar order via QRIS: generate QR, kirim foto, catat untuk di-poll. */
async function payQris(bot, chatId, messageId, userId) {
  if (!config.qris.enabled) {
    return editOrSend(bot, chatId, messageId, '⚠️ QRIS sedang tidak tersedia.', backButton('menu:order'));
  }
  const state = await getState(userId);
  if (!state || state.action !== 'order:confirm') {
    return editOrSend(bot, chatId, messageId, '⚠️ Sesi pembelian kedaluwarsa. Ulangi dari menu Beli Paket.', backButton('menu:order'));
  }
  const { sku, target } = state.data;
  const product = await getProduct(sku);
  const user = await getUser(userId);
  if (!product) {
    await clearState(userId);
    return editOrSend(bot, chatId, messageId, '⚠️ Produk tidak tersedia.', backButton('menu:order'));
  }
  const base = sellPrice(product, user.role);
  const { total } = autogopay.computeTotal(base);

  await clearState(userId);

  let qr;
  try {
    qr = await autogopay.generateQris(total);
  } catch (e) {
    logger.error('generateQris (order) error:', e.message);
    return editOrSend(bot, chatId, messageId, `⚠️ Gagal membuat QRIS: ${escapeHtml(e.message)}`, backButton('menu:order'));
  }

  // hapus pesan pilih-metode, ganti dengan foto QR
  try { await bot.deleteMessage(chatId, messageId); } catch (e) { /* ignore */ }

  const caption =
    `<b>BAYAR via QRIS</b>\n${LINE}\n` +
    `<code>${escapeHtml(
      `Paket : ${product.product_name}\n` +
      `Nomor : ${target}\n` +
      `Total : ${rupiah(total)}`
    )}</code>\n` +
    `${LINE}\nScan & bayar. Pesanan diproses otomatis setelah pembayaran masuk.`;

  const kb = {
    inline_keyboard: [
      [
        { text: 'Cek Sekarang', callback_data: `qris:check:${qr.transaction_id}` },
        { text: 'Batal', callback_data: `qris:cancel:${qr.transaction_id}` },
      ],
    ],
  };

  const sent = await bot.sendPhoto(chatId, qr.qr_url, { caption, parse_mode: 'HTML', reply_markup: kb });

  await qrisService.create({
    transaction_id: qr.transaction_id,
    order_id: qr.order_id,
    user_id: userId,
    chat_id: chatId,
    message_id: sent.message_id,
    purpose: 'order',
    base_amount: base,
    fee,
    amount: total,
    payload: { sku, target, product_name: product.product_name, cost_price: product.price },
    expiry_at: autogopay.parseExpiry(qr.expiry_time),
  });
}

module.exports = { showCategories, showBrands, showProducts, selectProduct, receiveTarget, pay, payQris };
