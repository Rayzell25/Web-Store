'use strict';

const { setState, clearState, getLastMenu } = require('../utils/session');
const { backButton } = require('../keyboards/menus');
const { escapeHtml, LINE } = require('../utils/format');
const { editOrSend: edit } = require('../utils/ui');

// Database zona XL/Axis: { "nama kota": "Provinsi - Zona X" } (491 kota se-Indonesia).
const ZONA = require('../assets/zona_data.json');

/**
 * Tampilkan teks di pesan menu yang SAMA (1 chat), bukan kirim pesan baru.
 * Pesan nomor/teks yang diketik user juga dihapus supaya chat rapi.
 * Kalau messageId menu tidak ada (mis. Redis hilang), fallback kirim baru.
 */
async function showResult(bot, chatId, userMsgId, text, keyboard) {
  // hapus pesan yang diketik user (best-effort, biar chat bersih)
  if (userMsgId) { bot.deleteMessage(chatId, userMsgId).catch(() => {}); }
  const menuId = await getLastMenu(chatId).catch(() => null);
  // edit pesan menu yang ada (editOrSend otomatis tangani pesan foto -> edit caption)
  return edit(bot, chatId, menuId || null, text, keyboard || backButton('menu:tools'));
}

/** Deteksi operator dari prefix nomor HP Indonesia */
function detectOperator(number) {
  const n = String(number).replace(/[^\d]/g, '').replace(/^62/, '0');
  const prefix = n.slice(0, 4);
  const map = {
    Telkomsel: ['0811', '0812', '0813', '0821', '0822', '0823', '0851', '0852', '0853'],
    Indosat: ['0814', '0815', '0816', '0855', '0856', '0857', '0858'],
    XL: ['0817', '0818', '0819', '0859', '0877', '0878'],
    Axis: ['0831', '0832', '0833', '0838'],
    Tri: ['0895', '0896', '0897', '0898', '0899'],
    Smartfren: ['0881', '0882', '0883', '0884', '0885', '0886', '0887', '0888', '0889'],
  };
  for (const [op, prefixes] of Object.entries(map)) {
    if (prefixes.includes(prefix)) return op;
  }
  return null;
}

/**
 * Cari zona dari nama kota. Pencarian akurat & anti-typo:
 *  1. Cocokkan apa adanya (setelah lowercase + rapikan spasi). Ini membuat nama
 *     yang memang mengandung kata "kota"/"kab" tetap valid (kotabaru, kotamobagu,
 *     kotawaringin barat, lima puluh kota, sukabumi).
 *  2. Kalau belum ketemu, buang kata administratif DI AWAL saja (kabupaten/kab./
 *     kota/kotamadya) lalu cocokkan lagi -> "kabupaten pati" / "kota bandung" jadi
 *     "pati" / "bandung".
 * Mengembalikan { city, zona } atau null.
 */
function lookupZona(raw) {
  const base = String(raw).toLowerCase().trim().replace(/\s+/g, ' ');
  if (!base) return null;
  if (ZONA[base]) return { city: base, zona: ZONA[base] };
  const stripped = base.replace(/^(kabupaten|kab\.?|kotamadya|kotamadia|kota)\s+/, '').trim();
  if (stripped && stripped !== base && ZONA[stripped]) return { city: stripped, zona: ZONA[stripped] };
  return null;
}

async function showTools(bot, chatId, messageId) {
  const text = `<b>TOOLS</b>\n${LINE}\nPilih alat bantu:`;
  const keyboard = {
    inline_keyboard: [
      [
        { text: 'CEK PULSA', callback_data: 'tools:pulsa' },
        { text: 'CEK AREA', callback_data: 'tools:area' },
      ],
      [{ text: '« KEMBALI', callback_data: 'menu:home' }],
    ],
  };
  await edit(bot, chatId, messageId, text, keyboard);
}

async function askPulsa(bot, chatId, messageId, userId) {
  await setState(userId, 'tools:pulsa', {});
  await edit(bot, chatId, messageId,
    `<b>CEK PULSA</b>\n${LINE}\nKetik nomor HP untuk cek operatornya (contoh: 081234567890):`,
    backButton('menu:tools'));
}

async function receivePulsa(bot, chatId, userId, number, userMsgId) {
  await clearState(userId);
  const clean = String(number).replace(/[^\d]/g, '');
  const op = detectOperator(clean);
  const text = op
    ? `<b>CEK PULSA</b>\n${LINE}\nNomor   : <code>${escapeHtml(clean)}</code>\nOperator: <b>${op}</b>\n\nKamu bisa beli pulsa/paket untuk operator ini di menu Beli Paket.`
    : `<b>CEK PULSA</b>\n${LINE}\nNomor   : <code>${escapeHtml(clean)}</code>\nOperator tidak dikenali. Pastikan nomor benar.`;
  await showResult(bot, chatId, userMsgId, text);
}

// ===== CEK AREA (zona XL/Axis) — langsung ketik nama kota/kabupaten =====

/** Minta nama kota/kabupaten (tanpa input nomor). */
async function askArea(bot, chatId, messageId, userId) {
  await setState(userId, 'tools:area', {});
  await edit(bot, chatId, messageId,
    `<b>CEK AREA XL / AXIS</b>\n${LINE}\nKetik <b>nama kota / kabupaten</b> untuk melihat zonanya.\n\nContoh: <code>pati</code>, <code>bandung</code>, <code>jepara</code>`,
    backButton('menu:tools'));
}

/** Terima nama kota -> cari zona -> tampilkan hasil. */
async function receiveArea(bot, chatId, userId, raw, userMsgId) {
  const found = lookupZona(raw);
  if (!found) {
    // belum ketemu -> tetap di state ini, minta ulang nama kota.
    await setState(userId, 'tools:area', {});
    await showResult(bot, chatId, userMsgId,
      `<b>CEK AREA XL / AXIS</b>\n${LINE}\nKota "<b>${escapeHtml(String(raw).trim())}</b>" tidak ditemukan.\n\nKetik nama kota/kabupaten dengan ejaan resmi tanpa disingkat (contoh: <code>pati</code>, <code>sidoarjo</code>, <code>kotabaru</code>), atau tekan « KEMBALI.`,
      backButton('menu:tools'));
    return;
  }
  await clearState(userId);
  const title = found.city.replace(/\b\w/g, (c) => c.toUpperCase());
  const text =
    `<b>HASIL CEK AREA</b>\n${LINE}\n` +
    `Kota    : <b>${escapeHtml(title)}</b>\n` +
    `Zona    : <b>${escapeHtml(found.zona)}</b>`;
  await showResult(bot, chatId, userMsgId, text);
}

module.exports = {
  showTools,
  askPulsa,
  askArea,
  receivePulsa,
  receiveArea,
  detectOperator,
  lookupZona,
};
