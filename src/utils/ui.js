'use strict';

const { stripPremium, hasPremium } = require('./premoji');

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
 *
 * Premium emoji: bila teks mengandung <tg-emoji> dan bot ternyata BELUM
 * eligible (bukan bot ber-username Fragment), Telegram menolak. Maka kita
 * coba ulang dengan tag premium di-strip -> fallback unicode, supaya pesan
 * tetap tampil dan tidak error.
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

// Error yang kemungkinan disebabkan premium/custom emoji tidak diizinkan.
function isEmojiError(e) {
  const m = errText(e);
  return (
    m.includes('custom_emoji') ||
    m.includes('custom emoji') ||
    m.includes("can't parse entities") ||
    m.includes('emoji') ||
    m.includes('entit')
  );
}

/**
 * Edit CAPTION pesan FOTO (mis. banner /start) supaya transisi tombol MULUS
 * tanpa hapus+kirim ulang (yang bikin "kedip"). Foto tetap, caption + tombol
 * yang berubah. Return true kalau berhasil.
 */
async function editCaption(bot, chatId, messageId, text, opts) {
  try {
    await bot.editMessageCaption(text, { chat_id: chatId, message_id: messageId, ...opts });
    return true;
  } catch (e) {
    if (isNotModified(e)) return true; // tidak berubah = anggap sukses
    // caption gagal karena premium emoji -> coba tanpa tag premium
    if (hasPremium(text) && isEmojiError(e)) {
      try {
        await bot.editMessageCaption(stripPremium(text), { chat_id: chatId, message_id: messageId, ...opts });
        return true;
      } catch (_) { /* gagal juga */ }
    }
    return false; // mis. caption > 1024 char -> biar caller fallback hapus+kirim
  }
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
      // Mungkin gagal karena premium emoji -> coba lagi tanpa tag premium.
      if (hasPremium(text) && isEmojiError(e) && !isUneditable(e)) {
        try {
          return await bot.editMessageText(stripPremium(text), { chat_id: chatId, message_id: messageId, ...opts });
        } catch (e2) {
          if (isNotModified(e2)) return;
          if (isUneditable(e2)) {
            // Pesan FOTO -> edit caption (mulus); fallback hapus+kirim.
            if (await editCaption(bot, chatId, messageId, stripPremium(text), opts)) return;
            try { await bot.deleteMessage(chatId, messageId); } catch (_) {}
          }
        }
      } else if (isUneditable(e)) {
        // Pesan FOTO (mis. banner /start): JANGAN hapus (bikin "kedip").
        // Edit caption-nya saja supaya foto tetap & transisi MULUS.
        if (await editCaption(bot, chatId, messageId, text, opts)) return;
        // Caption gagal (mis. teks > 1024 char) -> baru hapus & kirim baru.
        try { await bot.deleteMessage(chatId, messageId); } catch (_) { /* ignore */ }
      }
      // selain itu: jatuh ke kirim baru
    }
  }
  return safeSend(bot, chatId, text, opts);
}

/** Kirim pesan baru; jika gagal karena premium emoji, kirim ulang tanpa tag. */
async function safeSend(bot, chatId, text, opts) {
  try {
    return await bot.sendMessage(chatId, text, opts);
  } catch (e) {
    if (hasPremium(text) && isEmojiError(e)) {
      return bot.sendMessage(chatId, stripPremium(text), opts);
    }
    throw e;
  }
}

/** Kirim foto + caption; jika gagal karena premium emoji di caption, ulang tanpa tag. */
async function safeSendPhoto(bot, chatId, photo, opts) {
  try {
    return await bot.sendPhoto(chatId, photo, opts);
  } catch (e) {
    if (opts && hasPremium(opts.caption || '') && isEmojiError(e)) {
      return bot.sendPhoto(chatId, photo, { ...opts, caption: stripPremium(opts.caption) });
    }
    throw e;
  }
}

module.exports = { editOrSend, safeSend, safeSendPhoto, isNotModified, isUneditable };
