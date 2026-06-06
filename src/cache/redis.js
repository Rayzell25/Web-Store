'use strict';

const { createClient } = require('redis');
const { config } = require('../config');
const logger = require('../utils/logger');

let client = null;
let ready = false;

/**
 * Inisialisasi koneksi Redis. Jika REDIS_URL kosong atau gagal connect,
 * bot tetap jalan memakai fallback in-memory (lihat utils/session.js).
 */
async function initRedis() {
  if (!config.redisUrl) {
    logger.warn('REDIS_URL kosong — session memakai in-memory.');
    return null;
  }
  try {
    client = createClient({ url: config.redisUrl });
    client.on('error', (e) => {
      ready = false;
      logger.warn('Redis error:', e.message);
    });
    client.on('ready', () => {
      ready = true;
      logger.info('Redis terhubung.');
    });
    await client.connect();
    return client;
  } catch (e) {
    logger.warn('Gagal connect Redis, fallback in-memory:', e.message);
    client = null;
    ready = false;
    return null;
  }
}

function getClient() {
  return ready ? client : null;
}

function isReady() {
  return ready;
}

module.exports = { initRedis, getClient, isReady };
