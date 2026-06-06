'use strict';

const {
  getCategories,
  getBrands,
  getProductsByBrand,
  getProduct,
  sellPrice,
} = require('../services/productService');
const { getUser, addBalance } = require('../services/userService');
const {
  createTransaction,
  updateTransaction,
} = require('../services/trxService');
const digiflazz = require('../services/digiflazz');
const { config } = require('../config');
const { tokenFor, valueOf } = require('../utils/registry');
const { setState, clearState } = require('../utils/session');
const { gridKeyboard, backButton } = require('../keyboards/menus');
const { rupiah, escapeHtml, trxCode, truncate } = require('../utils/format');
const logger = require('../utils/logger');

/** Emoji per kategori untuk tampilan lebih rapi */
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

/** Langkah 1: tampilkan kategori */
async function showCategories(bot, chatId, messageId) {
  const cats = getCategories();
  if (!cats.length) {
    return editOrSend(bot, chatId, messageId,
      '⚠️ Produk belum tersedia.\n\nAdmin perlu menjalankan <b>Sync Produk</b> dari menu Admin terlebih dahulu.',
      backButton('menu:home'));
  }
  const items = cats.map((c) => ({
    text: `${catIcon(c.category)} ${truncate(c.category, 20)} (${c.c})`,
    data: `beli:cat:${tokenFor(c.category)}`,
  }));
  await editOrSend(bot, chatId, messageId,
    '🛒 <b>BELI PAKET</b>\n\nPilih kategori produk:',
    gridKeyboard(items, 2, 'menu:home'));
}

/** Langkah 2: tampilkan brand dalam kategori */
async function showBrands(bot, chatId, messageId, catToken) {
  const category = valueOf(catToken);
  if (!category) return showCategories(bot, chatId, messageId);
  const brands = getBrands(category);
  const items = brands.map((b) => ({
    text: `${truncate(b.brand, 22)} (${b.c})`,
    data: `beli:brand:${catToken}:${tokenFor(b.brand)}`,
  }));
  await editOrSend(bot, chatId, messageId,
    `🛒 <b>${escapeHtml(category)}</b>\n\nPilih operator / brand:`,
    gridKeyboard(items, 2, 'menu:beli'));
}

/** Langkah 3: tampilkan produk dalam brand */
async function showProducts(bot, chatId, messageId, catToken, brandToken, userId) {
  const category = valueOf(catToken);
  const brand = valueOf(brandToken);
  if (!category || !brand) return showCategories(bot, chatId, messageId);

  const user = getUser(userId);
  const products = getProductsByBrand(category, brand);
  const items = products.map((p) => {
    const harga = sellPrice(p, user.role);
    return {
      text: `${truncate(p.product_name, 24)} • ${rupiah(harga)}`,
      data: `beli:prod:${p.buyer_sku_code}`,
    };
  });
  await editOrSend(bot, chatId, messageId,
    `🛒 <b>${escapeHtml(brand)}</b> — ${escapeHtml(category)}\n\nPilih produk:`,
    gridKeyboard(items, 1, `beli:cat:${catToken}`));
}

/** Langkah 4: produk dipilih -> minta nomor tujuan */
async function selectProduct(bot, chatId, messageId, sku, userId) {
  const product = getProduct(sku);
  if (!product) {
    return editOrSend(bot, chatId, messageId, '⚠️ Produk tidak ditemukan.', backButton('menu:beli'));
  }
  const user = getUser(userId);
  const harga = sellPrice(product, user.role);

  setState(userId, 'beli:input_target', { sku });

  const text =
    `🛒 <b>DETAIL PRODUK</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📦 Produk: <b>${escapeHtml(product.product_name)}</b>\n` +
    `🏷 Brand: ${escapeHtml(product.brand)}\n` +
    `💵 Harga: <b>${rupiah(harga)}</b>\n` +
    (product.desc ? `📝 ${escapeHtml(product.desc)}\n` : '') +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `Silakan ketik <b>nomor tujuan</b> (HP / ID / No. pelanggan):`;

  await editOrSend(bot, chatId, messageId, text, backButton('menu:beli'));
}

/** Langkah 5: terima nomor tujuan -> tampilkan konfirmasi */
async function receiveTarget(bot, chatId, userId, target) {
  const state = require('../utils/session').getState(userId);
  if (!state || state.action !== 'beli:input_target') return;
  const product = getProduct(state.data.sku);
  if (!product) {
    clearState(userId);
    return bot.sendMessage(chatId, '⚠️ Produk sudah tidak tersedia.');
  }
  const user = getUser(userId);
  const harga = sellPrice(product, user.role);
  const cleanTarget = String(target).trim();

  setState(userId, 'beli:confirm', { sku: product.buyer_sku_code, target: cleanTarget });

  const text =
    `🧾 <b>KONFIRMASI PEMBELIAN</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📦 Produk: <b>${escapeHtml(product.product_name)}</b>\n` +
    `🎯 Tujuan: <code>${escapeHtml(cleanTarget)}</code>\n` +
    `💵 Harga: <b>${rupiah(harga)}</b>\n` +
    `💳 Saldo: ${rupiah(user.balance)}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    (user.balance < harga ? '\n⚠️ <b>Saldo tidak cukup.</b> Silakan top up dulu.\n' : '\nLanjutkan pembelian?');

  const keyboard = {
    inline_keyboard: [
      [
        { text: '✅ Bayar', callback_data: 'beli:pay' },
        { text: '❌ Batal', callback_data: 'menu:beli' },
      ],
    ],
  };
  await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard });
}

/** Langkah 6: eksekusi pembayaran + transaksi Digiflazz */
async function pay(bot, chatId, messageId, userId, notifyAdmins) {
  const session = require('../utils/session');
  const state = session.getState(userId);
  if (!state || state.action !== 'beli:confirm') {
    return editOrSend(bot, chatId, messageId, '⚠️ Sesi pembelian kedaluwarsa. Ulangi dari menu Beli Paket.', backButton('menu:beli'));
  }
  const { sku, target } = state.data;
  const product = getProduct(sku);
  const user = getUser(userId);
  if (!product) {
    session.clearState(userId);
    return editOrSend(bot, chatId, messageId, '⚠️ Produk tidak tersedia.', backButton('menu:beli'));
  }
  const harga = sellPrice(product, user.role);
  if (user.balance < harga) {
    session.clearState(userId);
    return editOrSend(bot, chatId, messageId,
      `⚠️ Saldo tidak cukup. Saldo: ${rupiah(user.balance)}, butuh: ${rupiah(harga)}.`,
      backButton('menu:topup'));
  }

  const refId = trxCode('CHO');

  // Potong saldo dulu (akan dikembalikan jika transaksi gagal)
  try {
    addBalance(userId, -harga);
  } catch (e) {
    session.clearState(userId);
    return editOrSend(bot, chatId, messageId, `⚠️ ${e.message}`, backButton('menu:topup'));
  }
  session.clearState(userId);

  createTransaction({
    ref_id: refId,
    user_id: userId,
    buyer_sku_code: sku,
    product_name: product.product_name,
    target,
    cost_price: product.price,
    sell_price: harga,
    status: 'Pending',
  });

  await editOrSend(bot, chatId, messageId,
    `⏳ Memproses transaksi <code>${refId}</code> ...`, null);

  let result;
  try {
    result = await digiflazz.topUp({
      buyerSkuCode: sku,
      customerNo: target,
      refId,
    });
  } catch (e) {
    logger.error('Digiflazz topUp error:', e.message);
    // refund
    addBalance(userId, harga);
    updateTransaction(refId, { status: 'Gagal', message: 'Gagal terhubung ke provider' });
    return editOrSend(bot, chatId, messageId,
      `❌ <b>Transaksi Gagal</b>\nGagal menghubungi provider. Saldo dikembalikan.\nRef: <code>${refId}</code>`,
      backButton('menu:home'));
  }

  const status = digiflazz.mapStatus(result.status);
  const sn = result.sn || null;
  const message = result.message || '';

  if (status === 'Gagal') {
    addBalance(userId, harga); // refund
    updateTransaction(refId, { status: 'Gagal', message, sn });
    return editOrSend(bot, chatId, messageId,
      `❌ <b>Transaksi Gagal</b>\n${escapeHtml(message)}\nSaldo dikembalikan.\nRef: <code>${refId}</code>`,
      backButton('menu:home'));
  }

  updateTransaction(refId, { status, message, sn });
  const updatedUser = getUser(userId);

  const statusIcon = status === 'Sukses' ? '✅' : '⏳';
  const text =
    `${statusIcon} <b>Transaksi ${status}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📦 ${escapeHtml(product.product_name)}\n` +
    `🎯 Tujuan: <code>${escapeHtml(target)}</code>\n` +
    `💵 Harga: ${rupiah(harga)}\n` +
    (sn ? `🔑 SN: <code>${escapeHtml(sn)}</code>\n` : '') +
    (message ? `💬 ${escapeHtml(message)}\n` : '') +
    `🧾 Ref: <code>${refId}</code>\n` +
    `💳 Sisa Saldo: ${rupiah(updatedUser.balance)}`;

  await editOrSend(bot, chatId, messageId, text, backButton('menu:home'));

  if (typeof notifyAdmins === 'function') {
    notifyAdmins(
      `🔔 Transaksi ${status}\nUser: ${user.name} (${userId})\n${product.product_name} → ${target}\nHarga: ${rupiah(harga)} | Ref: ${refId}`
    );
  }
}

/** Helper: edit jika ada messageId, kalau tidak kirim baru */
async function editOrSend(bot, chatId, messageId, text, replyMarkup) {
  const opts = { parse_mode: 'HTML' };
  if (replyMarkup) opts.reply_markup = replyMarkup;
  if (messageId) {
    try {
      return await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        ...opts,
      });
    } catch (e) {
      // fallthrough ke kirim baru
    }
  }
  return bot.sendMessage(chatId, text, opts);
}

module.exports = {
  showCategories,
  showBrands,
  showProducts,
  selectProduct,
  receiveTarget,
  pay,
};
