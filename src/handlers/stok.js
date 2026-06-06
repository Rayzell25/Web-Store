'use strict';

const {
  getCategories,
  getBrands,
  getProductsByBrand,
  sellPrice,
} = require('../services/productService');
const { getUser } = require('../services/userService');
const { tokenFor, valueOf } = require('../utils/registry');
const { gridKeyboard, backButton } = require('../keyboards/menus');
const { rupiah, escapeHtml, truncate } = require('../utils/format');

/**
 * Menu STOK: hanya untuk MELIHAT daftar produk + harga + status
 * (active / gangguan), tanpa membeli. Berguna untuk cek ketersediaan.
 */
async function showCategories(bot, chatId, messageId) {
  const cats = getCategories();
  if (!cats.length) {
    return edit(bot, chatId, messageId,
      '⚠️ Belum ada produk. Admin perlu Sync Produk dulu.',
      backButton('menu:home'));
  }
  const items = cats.map((c) => ({
    text: `${truncate(c.category, 20)} (${c.c})`,
    data: `stok:cat:${tokenFor(c.category)}`,
  }));
  await edit(bot, chatId, messageId,
    '📦 <b>CEK STOK & HARGA</b>\n\nPilih kategori:',
    gridKeyboard(items, 2, 'menu:home'));
}

async function showBrands(bot, chatId, messageId, catToken) {
  const category = valueOf(catToken);
  if (!category) return showCategories(bot, chatId, messageId);
  const brands = getBrands(category);
  const items = brands.map((b) => ({
    text: `${truncate(b.brand, 22)} (${b.c})`,
    data: `stok:brand:${catToken}:${tokenFor(b.brand)}`,
  }));
  await edit(bot, chatId, messageId,
    `📦 <b>${escapeHtml(category)}</b>\n\nPilih brand untuk lihat daftar harga:`,
    gridKeyboard(items, 2, 'menu:stok'));
}

async function showList(bot, chatId, messageId, catToken, brandToken, userId) {
  const category = valueOf(catToken);
  const brand = valueOf(brandToken);
  if (!category || !brand) return showCategories(bot, chatId, messageId);

  const user = getUser(userId);
  const products = getProductsByBrand(category, brand);

  let text = `📦 <b>${escapeHtml(brand)}</b> — ${escapeHtml(category)}\n━━━━━━━━━━━━━━━━━━━━\n`;
  if (!products.length) {
    text += '\nTidak ada produk aktif.';
  } else {
    for (const p of products) {
      const harga = sellPrice(p, user.role);
      text += `\n✅ ${escapeHtml(p.product_name)}\n    💵 <b>${rupiah(harga)}</b>\n`;
    }
  }
  await edit(bot, chatId, messageId, text, backButton(`stok:cat:${catToken}`));
}

async function edit(bot, chatId, messageId, text, replyMarkup) {
  const opts = { parse_mode: 'HTML' };
  if (replyMarkup) opts.reply_markup = replyMarkup;
  if (messageId) {
    try {
      return await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts });
    } catch (e) { /* fall through */ }
  }
  return bot.sendMessage(chatId, text, opts);
}

module.exports = { showCategories, showBrands, showList };
