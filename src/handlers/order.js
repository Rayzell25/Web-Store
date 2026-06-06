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
const { tokenFor, valueOf } = require('../utils/registry');
const { setState, clearState, getState } = require('../utils/session');
const { gridKeyboard, backButton } = require('../keyboards/menus');
const { rupiah, escapeHtml, trxCode, truncate, LINE } = require('../utils/format');
const logger = require('../utils/logger');

function catIcon(cat) {
  const c = String(cat).toLowerCase();
  if (c.includes('pulsa')) return '📱';
  if (c.includes('data')) return '🌐';
  if (c.includes('pln') || c.includes('listrik')) return '⚡';
  if (c.includes('game')) return '🎮';
  if (c.includes('emoney') || c.includes('e-money') || c.includes('saldo')) return '💳';
  if (c.includes('voucher')) return '🎟';
  if (c.includes('tv')) return '📺';
  if (c.includes('masa') || c.includes('aktif')) return '📶';
  return '📦';
}

async function showCategories(bot, chatId, messageId) {
  const cats = await getCategories();
  if (!cats.length) {
    return editOrSend(bot, chatId, messageId,
      '⚠️ Produk belum tersedia.\n\nAdmin perlu menjalankan <b>Sync Produk</b> dari menu Admin terlebih dahulu.',
      backButton('menu:home'));
  }
  const items = cats.map((c) => ({
    text: `${catIcon(c.category)} ${truncate(c.category, 20)} (${c.c})`,
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
    return bot.sendMessage(chatId, '⚠️ Produk sudah tidak tersedia.');
  }
  const user = await getUser(userId);
  const harga = sellPrice(product, user.role);
  const cleanTarget = String(target).trim();

  await setState(userId, 'order:confirm', { sku: product.buyer_sku_code, target: cleanTarget });

  const detail =
    `Produk : ${product.product_name}\n` +
    `Tujuan : ${cleanTarget}\n` +
    `Harga  : ${rupiah(harga)}\n` +
    `Saldo  : ${rupiah(user.balance)}`;

  const text =
    `<b>KONFIRMASI</b>\n` +
    `${LINE}\n` +
    `<code>${escapeHtml(detail)}</code>\n` +
    `${LINE}\n` +
    (user.balance < harga ? '<b>Saldo tidak cukup.</b> Silakan top up dulu.' : 'Lanjut bayar?');

  const keyboard = {
    inline_keyboard: [
      [
        { text: '✅ Bayar', callback_data: 'order:pay' },
        { text: '✖ Batal', callback_data: 'menu:order' },
      ],
    ],
  };
  await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard });
}

async function pay(bot, chatId, messageId, userId, notifyAdmins) {
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
  const harga = sellPrice(product, user.role);
  if (user.balance < harga) {
    await clearState(userId);
    return editOrSend(bot, chatId, messageId,
      `⚠️ Saldo tidak cukup. Saldo: ${rupiah(user.balance)}, butuh: ${rupiah(harga)}.`,
      backButton('menu:deposit'));
  }

  const refId = trxCode('CHO');

  try {
    await addBalance(userId, -harga); // potong dulu, refund jika gagal
  } catch (e) {
    await clearState(userId);
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

module.exports = { showCategories, showBrands, showProducts, selectProduct, receiveTarget, pay };
