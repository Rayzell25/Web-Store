'use strict';

const { setState, clearState } = require('../utils/session');
const { backButton } = require('../keyboards/menus');
const { escapeHtml, LINE } = require('../utils/format');
const { editOrSend: edit } = require('../utils/ui');

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

// Kode area telepon (landline) Indonesia — subset umum.
const AREA_CODES = {
  '021': 'Jakarta, Bekasi, Depok, Tangerang',
  '022': 'Bandung, Cimahi',
  '024': 'Semarang',
  '031': 'Surabaya, Sidoarjo',
  '061': 'Medan',
  '0251': 'Bogor',
  '0254': 'Serang',
  '0260': 'Subang',
  '0261': 'Sumedang',
  '0264': 'Purwakarta',
  '0265': 'Tasikmalaya',
  '0267': 'Karawang',
  '0271': 'Surakarta (Solo)',
  '0274': 'Yogyakarta',
  '0281': 'Purwokerto',
  '0291': 'Demak, Jepara',
  '0298': 'Salatiga',
  '0341': 'Malang',
  '0351': 'Madiun',
  '0361': 'Denpasar (Bali)',
  '0370': 'Mataram (NTB)',
  '0380': 'Kupang (NTT)',
  '0411': 'Makassar',
  '0431': 'Manado',
  '0511': 'Banjarmasin',
  '0541': 'Samarinda',
  '0561': 'Pontianak',
  '0651': 'Banda Aceh',
  '0711': 'Palembang',
  '0721': 'Bandar Lampung',
  '0741': 'Jambi',
  '0751': 'Padang',
  '0761': 'Pekanbaru',
  '0778': 'Batam',
  '0967': 'Jayapura (Papua)',
};

function areaInfo(number) {
  const n = String(number).replace(/[^\d]/g, '').replace(/^62/, '0');
  if (/^08/.test(n)) {
    return { type: 'mobile', operator: detectOperator(n) };
  }
  for (const len of [4, 3]) {
    const pre = n.slice(0, len);
    if (AREA_CODES[pre]) return { type: 'landline', code: pre, region: AREA_CODES[pre] };
  }
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

async function askArea(bot, chatId, messageId, userId) {
  await setState(userId, 'tools:area', {});
  await edit(bot, chatId, messageId,
    `<b>CEK AREA</b>\n${LINE}\nKetik nomor telepon untuk cek wilayah / operator (contoh: 0215551234 atau 081234567890):`,
    backButton('menu:tools'));
}

async function receivePulsa(bot, chatId, userId, number) {
  await clearState(userId);
  const clean = String(number).replace(/[^\d]/g, '');
  const op = detectOperator(clean);
  const text = op
    ? `<b>CEK PULSA</b>\n${LINE}\nNomor   : <code>${escapeHtml(clean)}</code>\nOperator: <b>${op}</b>\n\nKamu bisa beli pulsa/paket untuk operator ini di menu Beli Paket.`
    : `<b>CEK PULSA</b>\n${LINE}\nNomor   : <code>${escapeHtml(clean)}</code>\nOperator tidak dikenali. Pastikan nomor benar.`;
  await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: backButton('menu:tools') });
}

async function receiveArea(bot, chatId, userId, number) {
  await clearState(userId);
  const clean = String(number).replace(/[^\d]/g, '');
  const info = areaInfo(clean);
  let body;
  if (!info) {
    body = `Nomor : <code>${escapeHtml(clean)}</code>\nWilayah/operator tidak dikenali.`;
  } else if (info.type === 'mobile') {
    body = `Nomor   : <code>${escapeHtml(clean)}</code>\nJenis   : Seluler (HP)\nOperator: <b>${info.operator || 'tidak dikenali'}</b>`;
  } else {
    body = `Nomor   : <code>${escapeHtml(clean)}</code>\nJenis   : Telepon rumah\nKode    : <b>${info.code}</b>\nWilayah : <b>${escapeHtml(info.region)}</b>`;
  }
  await bot.sendMessage(chatId, `<b>CEK AREA</b>\n${LINE}\n${body}`,
    { parse_mode: 'HTML', reply_markup: backButton('menu:tools') });
}

module.exports = { showTools, askPulsa, askArea, receivePulsa, receiveArea, detectOperator, areaInfo };
