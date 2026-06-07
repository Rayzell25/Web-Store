'use strict';

/**
 * Helper UI terpusat agar navigasi tombol SELALU mengedit pesan yang sama
 * (cukup 1 chat), bukan mengirim chat baru tiap klik.
 *
 * Strategi editOrSend:
 *  - Jika ada messageId: coba editMessageText.
 *     • Error "message is not modified" (klik tombol yang sama) -> DIAM, tidak
 *       kirim chat baru.
 *     • Error pesan tidak bisa diedit (mis. pesan FOTO, atau pesan kadaluwarsa)
 *       -> hapus pesan lama lalu kirim teks baru, jadi tetap 1 gelembung.
 *     • Error lain -> kirim baru sebagai fallback.
 *  - Jika tidak ada messageId: kirim baru.
 */

function errText(e) {
  return String((e && e.message) || '').toLowerCase();
}

function isNotModified(e) {
  return errText(e).includes('message is not modified');
}

// Pesan foto/caption tidak punya teks untuk diedit, atau pesan terlalu lama.
function isUneditable(e) {
  const m = errText(e);
  return (
    m.includes('no text in the message to edit') ||
    m.includes("message can't be edited") ||
    m.includes('message to edit not found') ||
    m.includes('message_id_invalid') ||
    m.includes('there is no caption in the message to edit')
  );
}

async function editOrSend(bot, chatId, messageId, text, replyMarkup) {
  const opts = { parse_mode: 'HTML' };
  if (replyMarkup) opts.reply_markup = replyMarkup;

  if (messageId) {
    try {
      return await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts });
    } catch (e) {
      // Klik tombol yang sama -> jangan kirim chat baru, cukup diamkan.
      if (isNotModified(e)) return;
      // Pesan foto / tidak bisa diedit -> buang pesan lama supaya tidak menumpuk.
      if (isUneditable(e)) {
        try { await bot.deleteMessage(chatId, messageId); } catch (_) { /* ignore */ }
      }
      // selain itu: jatuh ke kirim baru
    }
  }
  return bot.sendMessage(chatId, text, opts);
}

module.exports = { editOrSend, isNotModified, isUneditable };
