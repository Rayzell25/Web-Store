'use strict';

const { stripPremium, hasPremium, markupHasButtonIcon, downgradeButtonIcons } = require('./premoji');

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

// Error yang kemungkinan disebabkan field tombol (mis. icon_custom_emoji_id
// belum didukung Local Bot API lama / bot belum eligible).
function isButtonError(e) {
  const m = errText(e);
  return (
    isEmojiError(e) ||
    m.includes('button') ||
    m.includes('reply markup') ||
    m.includes('reply_markup') ||
    m.includes('keyboard')
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
      if (!isUneditable(e)) {
        // Mungkin gagal karena premium emoji (teks) atau icon_custom_emoji_id
        // (tombol) -> coba edit ulang dengan versi yang diturunkan ke unicode.
        const needEmoji = hasPremium(text) && isEmojiError(e);
        const needBtn = markupHasButtonIcon(opts.reply_markup) && isButtonError(e);
        if (needEmoji || needBtn) {
          const t2 = needEmoji ? stripPremium(text) : text;
          const opts2 = { ...opts };
          if (needBtn) opts2.reply_markup = downgradeButtonIcons(opts.reply_markup);
          try {
            return await bot.editMessageText(t2, { chat_id: chatId, message_id: messageId, ...opts2 });
          } catch (e2) {
            if (isNotModified(e2)) return;
            if (isUneditable(e2)) { try { await bot.deleteMessage(chatId, messageId); } catch (_) {} }
          }
        }
      } else {
        // Pesan foto / tidak bisa diedit -> buang pesan lama supaya tidak menumpuk.
        try { await bot.deleteMessage(chatId, messageId); } catch (_) { /* ignore */ }
      }
      // selain itu: jatuh ke kirim baru
    }
  }
  return safeSend(bot, chatId, text, opts);
}

/** Kirim pesan baru; fallback jika premium emoji / icon tombol tidak didukung. */
async function safeSend(bot, chatId, text, opts) {
  try {
    return await bot.sendMessage(chatId, text, opts);
  } catch (e) {
    const opts2 = { ...(opts || {}) };
    let text2 = text;
    let changed = false;
    if (hasPremium(text) && isEmojiError(e)) { text2 = stripPremium(text); changed = true; }
    if (opts2.reply_markup && markupHasButtonIcon(opts2.reply_markup) && isButtonError(e)) {
      opts2.reply_markup = downgradeButtonIcons(opts2.reply_markup);
      changed = true;
    }
    if (changed) return bot.sendMessage(chatId, text2, opts2);
    throw e;
  }
}

/** Kirim foto + caption; fallback jika premium emoji / icon tombol tidak didukung. */
async function safeSendPhoto(bot, chatId, photo, opts) {
  try {
    return await bot.sendPhoto(chatId, photo, opts);
  } catch (e) {
    const opts2 = { ...(opts || {}) };
    let changed = false;
    if (opts2.caption && hasPremium(opts2.caption) && isEmojiError(e)) {
      opts2.caption = stripPremium(opts2.caption);
      changed = true;
    }
    if (opts2.reply_markup && markupHasButtonIcon(opts2.reply_markup) && isButtonError(e)) {
      opts2.reply_markup = downgradeButtonIcons(opts2.reply_markup);
      changed = true;
    }
    if (changed) return bot.sendPhoto(chatId, photo, opts2);
    throw e;
  }
}

module.exports = { editOrSend, safeSend, safeSendPhoto, isNotModified, isUneditable };
