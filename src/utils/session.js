'use strict';

const { getClient } = require('../cache/redis');

/**
 * State percakapan per user untuk alur multi-langkah
 * (input nomor tujuan, nominal deposit, dll).
 *
 * Backend: Redis bila tersedia, kalau tidak fallback ke Map in-memory.
 * Semua fungsi async agar seragam.
 */
const TTL_SEC = 10 * 60; // 10 menit
const mem = new Map();

function key(userId) {
  return `sess:${userId}`;
}

async function setState(userId, action, data = {}) {
  const payload = { action, data };
  const redis = getClient();
  if (redis) {
    await redis.set(key(userId), JSON.stringify(payload), { EX: TTL_SEC });
    return;
  }
  mem.set(Number(userId), { ...payload, expires: Date.now() + TTL_SEC * 1000 });
}

async function getState(userId) {
  const redis = getClient();
  if (redis) {
    const raw = await redis.get(key(userId));
    return raw ? JSON.parse(raw) : null;
  }
  const s = mem.get(Number(userId));
  if (!s) return null;
  if (Date.now() > s.expires) {
    mem.delete(Number(userId));
    return null;
  }
  return { action: s.action, data: s.data };
}

async function clearState(userId) {
  const redis = getClient();
  if (redis) {
    await redis.del(key(userId));
    return;
  }
  mem.delete(Number(userId));
}

/**
 * Klaim state secara ATOMIK (baca + hapus sekaligus). Mengembalikan state HANYA
 * ke pemanggil PERTAMA; pemanggil berikutnya (mis. tombol di-tap 2x cepat) dapat
 * null. Dipakai untuk mencegah double-proses (mis. double-charge saat bayar SALDO).
 */
async function claimState(userId, expectedAction) {
  const redis = getClient();
  if (redis) {
    const raw = await redis.get(key(userId));
    if (!raw) return null;
    let state;
    try { state = JSON.parse(raw); } catch (e) { return null; }
    if (expectedAction && state.action !== expectedAction) return null;
    // DEL atomik: dari sekian pemanggil konkuren, hanya 1 yang dapat hasil 1.
    const removed = await redis.del(key(userId));
    return removed === 1 ? state : null;
  }
  // in-memory: get+delete sinkron (single-thread) -> atomik tanpa await di tengah.
  const s = mem.get(Number(userId));
  if (!s) return null;
  if (Date.now() > s.expires) { mem.delete(Number(userId)); return null; }
  if (expectedAction && s.action !== expectedAction) return null;
  mem.delete(Number(userId));
  return { action: s.action, data: s.data };
}

// ===== last-menu tracking (Opsi A: hapus menu lama tiap /start baru) =====
// TTL 47 jam (< 48 jam batas Telegram deleteMessage) supaya nggak coba hapus
// pesan yang sudah terlalu tua (akan ditolak Telegram).
const MENU_TTL_SEC = 47 * 60 * 60;
const memMenu = new Map(); // chatId -> { messageId, expires }

function menuKey(chatId) {
  return `lastmenu:${chatId}`;
}

async function setLastMenu(chatId, messageId) {
  const redis = getClient();
  if (redis) {
    await redis.set(menuKey(chatId), String(messageId), { EX: MENU_TTL_SEC });
    return;
  }
  memMenu.set(Number(chatId), { messageId, expires: Date.now() + MENU_TTL_SEC * 1000 });
}

async function getLastMenu(chatId) {
  const redis = getClient();
  if (redis) {
    const v = await redis.get(menuKey(chatId));
    return v ? Number(v) : null;
  }
  const s = memMenu.get(Number(chatId));
  if (!s) return null;
  if (Date.now() > s.expires) { memMenu.delete(Number(chatId)); return null; }
  return s.messageId;
}

async function clearLastMenu(chatId) {
  const redis = getClient();
  if (redis) { await redis.del(menuKey(chatId)); return; }
  memMenu.delete(Number(chatId));
}

// ===== tracking pesan transaksi per ref_id =====
// Simpan { chatId, messageId } pesan "PENDING" (di DM user & grup private) supaya
// saat status final (Sukses/Gagal) pesannya bisa DI-EDIT, bukan kirim baru.
// TTL 1 jam: transaksi prabayar pasti final jauh sebelum itu.
const TRXMSG_TTL_SEC = 60 * 60;
const memTrxMsg = new Map(); // ref_id -> { value, expires }

function trxMsgKey(refId, scope) {
  return `trxmsg:${scope}:${refId}`;
}

async function setTrxMsg(refId, scope, chatId, messageId) {
  if (!refId || !scope || !chatId || !messageId) return;
  const payload = JSON.stringify({ chatId, messageId });
  const redis = getClient();
  if (redis) {
    await redis.set(trxMsgKey(refId, scope), payload, { EX: TRXMSG_TTL_SEC });
    return;
  }
  memTrxMsg.set(trxMsgKey(refId, scope), { value: payload, expires: Date.now() + TRXMSG_TTL_SEC * 1000 });
}

async function getTrxMsg(refId, scope) {
  const redis = getClient();
  if (redis) {
    const raw = await redis.get(trxMsgKey(refId, scope));
    return raw ? JSON.parse(raw) : null;
  }
  const s = memTrxMsg.get(trxMsgKey(refId, scope));
  if (!s) return null;
  if (Date.now() > s.expires) { memTrxMsg.delete(trxMsgKey(refId, scope)); return null; }
  return JSON.parse(s.value);
}

async function clearTrxMsg(refId, scope) {
  const redis = getClient();
  if (redis) { await redis.del(trxMsgKey(refId, scope)); return; }
  memTrxMsg.delete(trxMsgKey(refId, scope));
}

module.exports = {
  setState, getState, clearState, claimState,
  setLastMenu, getLastMenu, clearLastMenu,
  setTrxMsg, getTrxMsg, clearTrxMsg,
};
