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
const { rupiah, escapeHtml, truncate, LINE } = require('../utils/format');
const { editOrSend: edit } = require('../utils/ui');

/**
 * Menu STOK: hanya untuk MELIHAT daftar produk + harga + status
 * (active / gangguan), tanpa membeli. Berguna untuk cek ketersediaan.
 */
async function showCategories(bot, chatId, messageId) {
  const cats = await getCategories();
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
    `<b>CEK HARGA</b>\n${LINE}\nPilih kategori:`,
    gridKeyboard(items, 2, 'menu:home'));
}

async function showBrands(bot, chatId, messageId, catToken) {
  const category = valueOf(catToken);
  if (!category) return showCategories(bot, chatId, messageId);
  const brands = await getBrands(category);
  const items = brands.map((b) => ({
    text: `${truncate(b.brand, 22)} (${b.c})`,
    data: `stok:brand:${catToken}:${tokenFor(b.brand)}`,
  }));
  await edit(bot, chatId, messageId,
    `<b>${escapeHtml(category.toUpperCase())}</b>\n${LINE}\nPilih brand untuk lihat daftar harga:`,
    gridKeyboard(items, 2, 'menu:stok'));
}

async function showList(bot, chatId, messageId, catToken, brandToken, userId) {
  const category = valueOf(catToken);
  const brand = valueOf(brandToken);
  if (!category || !brand) return showCategories(bot, chatId, messageId);

  const user = await getUser(userId);
  const products = await getProductsByBrand(category, brand);

  let text = `<b>${escapeHtml(brand.toUpperCase())}</b> · ${escapeHtml(category)}\n${LINE}\n`;
  if (!products.length) {
    text += 'Tidak ada produk aktif.';
  } else {
    for (const p of products) {
      const harga = sellPrice(p, user.role);
      text += `• ${escapeHtml(p.product_name)}\n  <b>${rupiah(harga)}</b>\n`;
    }
  }
  await edit(bot, chatId, messageId, text, backButton(`stok:cat:${catToken}`));
}

module.exports = { showCategories, showBrands, showList };
