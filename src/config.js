'use strict';

// Memuat variabel dari .env. Semua data SENSITIF (token, key, api_hash)
// hanya berada di .env — file ini tidak menyimpan nilai rahasia apa pun,
// hanya membaca dari process.env dan menyediakan default non-sensitif.
require('dotenv').config();

function parseAdminIds(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
}

const config = {
  // --- rahasia: dibaca langsung dari env, tidak ditulis sebagai literal ---
  botToken: process.env.BOT_TOKEN || '',
  adminIds: parseAdminIds(process.env.ADMIN_IDS),

  telegram: {
    // baseApiUrl untuk Local Bot API (latency rendah). Kosong = server resmi.
    apiRoot: process.env.BOT_API_ROOT || '',
    apiId: process.env.TELEGRAM_API_ID || '',
    apiHash: process.env.TELEGRAM_API_HASH || '',
  },

  redisUrl: process.env.REDIS_URL || '',

  // PostgreSQL. Pakai DATABASE_URL penuh, atau biarkan kosong & isi PG* satu-satu.
  databaseUrl: process.env.DATABASE_URL || '',
  pg: {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'ppob',
    password: process.env.PGPASSWORD || '',
    database: process.env.PGDATABASE || 'ppob',
  },

  // Bot khusus pengiriman backup (token bisa beda dari bot utama).
  backupBotToken: process.env.BACKUP_BOT_TOKEN || '',
  // Chat/channel tujuan backup database (offsite). Kosong = tidak kirim.
  backupChatId: process.env.BACKUP_CHAT_ID || '',

  digiflazz: {
    username: process.env.DIGIFLAZZ_USERNAME || '',
    apiKey: process.env.DIGIFLAZZ_API_KEY || '',
    mode: process.env.DIGIFLAZZ_MODE || 'prepaid',
  },

  // --- non-sensitif: default tampilan & aturan ---
  topup: {
    info: process.env.TOPUP_INFO || 'Hubungi admin untuk info rekening.',
    min: Number(process.env.MIN_TOPUP || 10000),
  },

  store: {
    name: process.env.STORE_NAME || 'Cho Store PPOB',
    maintenance: process.env.MAINTENANCE_INFO || '-',
    vpnUrl: process.env.BOT_VPN_URL || '',
    adminContact: process.env.ADMIN_CONTACT || '',
  },
};

function isAdmin(telegramId) {
  return config.adminIds.includes(Number(telegramId));
}

function assertConfig() {
  const missing = [];
  if (!config.botToken) missing.push('BOT_TOKEN');
  if (config.adminIds.length === 0) missing.push('ADMIN_IDS');
  if (!config.databaseUrl && !config.pg.password) missing.push('DATABASE_URL (atau PGPASSWORD)');
  if (missing.length) {
    throw new Error(
      `Konfigurasi belum lengkap. Set variabel berikut di .env: ${missing.join(', ')}`
    );
  }
}

module.exports = { config, isAdmin, assertConfig };
