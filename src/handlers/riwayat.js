'use strict';

const { getUserTransactions } = require('../services/trxService');
const { userDeposits } = require('../services/depositService');
const { rupiah, escapeHtml, tanggal, LINE } = require('../utils/format');
const { editOrSend } = require('../utils/ui');

function icon(status) {
  const s = String(status).toLowerCase();
  if (['sukses', 'approved'].includes(s)) return '[OK]';
  if (['gagal', 'rejected'].includes(s)) return '[X]';
  return '[!]'; // pending / lainnya
}

function jamDetik() {
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Asia/Jakarta',
  }).format(new Date());
}

/** Riwayat gabungan: pembelian + top up, urut waktu terbaru. */
async function showRiwayat(bot, chatId, messageId, userId) {
  const [trx, tops] = await Promise.all([
    getUserTransactions(userId, 15),
    userDeposits(userId, 15),
  ]);

  const items = [];
  for (const t of trx) {
    items.push({
      created_at: Number(t.created_at),
      icon: icon(t.status),
      title: t.product_name || 'Pembelian',
      sub: `${t.target || '-'}`,
      amount: t.sell_price,
      status: t.status,
      ref: t.ref_id,
    });
  }
  for (const d of tops) {
    items.push({
      created_at: Number(d.created_at),
      icon: icon(d.status),
      title: 'Top Up Saldo',
      sub: null,
      amount: d.amount,
      status: d.status,
      ref: `#${d.id}`,
    });
  }
  items.sort((a, b) => b.created_at - a.created_at);
  const shown = items.slice(0, 10);

  let body;
  if (!shown.length) {
    body = 'Belum ada transaksi.';
  } else {
    body = `${shown.length} Transaksi Terakhir:\n`;
    for (const it of shown) {
      body +=
        `\n${it.icon} ${rupiah(it.amount)} — ${escapeHtml(it.status)}\n` +
        `Paket: ${escapeHtml(it.title)}\n` +
        (it.sub ? `Tujuan: ${escapeHtml(it.sub)}\n` : '') +
        `Ref: <code>${escapeHtml(it.ref)}</code> · ${tanggal(it.created_at)}\n`;
    }
  }

  const text =
    `<b>RIWAYAT TRANSAKSI</b>\n${LINE}\n${body}\n${LINE}\n` +
    `Total: ${shown.length} transaksi\n` +
    `<i>diperbarui ${jamDetik()}</i>`;

  const keyboard = {
    inline_keyboard: [
      [{ text: 'REFRESH', callback_data: 'menu:riwayat' }],
      [{ text: '« MENU UTAMA', callback_data: 'menu:home' }],
    ],
  };

  // Selalu edit pesan yang sama (tetap 1 chat). editOrSend mengabaikan error
  // "not modified" dan menangani kasus pesan foto secara otomatis.
  return editOrSend(bot, chatId, messageId, text, keyboard);
}

module.exports = { showRiwayat };
