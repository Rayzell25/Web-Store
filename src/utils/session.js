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

module.exports = { setState, getState, clearState };
