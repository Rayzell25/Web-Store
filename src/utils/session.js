'use strict';

/**
 * State percakapan sederhana per user (in-memory).
 * Dipakai untuk alur multi-langkah: input nomor tujuan, nominal top up, dll.
 * Format state: { action: string, data: object, expires: number }
 */
const store = new Map();
const TTL = 10 * 60 * 1000; // 10 menit

function setState(userId, action, data = {}) {
  store.set(Number(userId), {
    action,
    data,
    expires: Date.now() + TTL,
  });
}

function getState(userId) {
  const s = store.get(Number(userId));
  if (!s) return null;
  if (Date.now() > s.expires) {
    store.delete(Number(userId));
    return null;
  }
  return s;
}

function clearState(userId) {
  store.delete(Number(userId));
}

module.exports = { setState, getState, clearState };
