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

  // URL publik web (untuk tombol Mini App / web_app). Kosong = tombol disembunyikan.
  webUrl: process.env.PUBLIC_URL || '',

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
    // Interval (detik) poller rekonsiliasi status transaksi Pending. 0 = nonaktif.
    reconcileSec: Number(process.env.DIGIFLAZZ_RECONCILE_SEC || 60),
    // Transaksi Pending lebih tua dari ini (menit) dianggap GAGAL & di-refund
    // bila Digiflazz tetap tidak memberi kepastian. 0 = jangan auto-gagalkan.
    reconcileTimeoutMin: Number(process.env.DIGIFLAZZ_RECONCILE_TIMEOUT_MIN || 30),
  },

  // --- non-sensitif: default tampilan & aturan ---
  topup: {
    info: process.env.TOPUP_INFO || 'Hubungi admin untuk info rekening.',
    min: Number(process.env.MIN_TOPUP || 10000),
  },

  // Anti-dobel order: cegah double-charge bila pembeli menekan "beli" berkali-kali.
  // Pembelian produk+nomor yang sama oleh user yang sama ditolak bila masih
  // diproses (Pending) ATAU baru saja SUKSES dalam jendela ini (detik).
  // Transaksi yang GAGAL tidak menghalangi (boleh coba lagi). 0 = nonaktif cooldown
  // (tetap blokir yang masih Pending).
  order: {
    dedupeSec: Number(process.env.ORDER_DEDUP_SEC || 120),
  },

  store: {
    name: process.env.STORE_NAME || 'Rayzell Store PPOB',
    maintenance: process.env.MAINTENANCE_INFO || '-',
    vpnUrl: process.env.BOT_VPN_URL || '',
    adminContact: process.env.ADMIN_CONTACT || '',
  },

  // Login Google (OAuth2). Kosong = tombol Google nonaktif (no-op).
  // Secret HANYA di .env. redirectUri harus sama persis dgn yang didaftarkan
  // di Google Cloud Console (mis. https://domain/api/auth/google/callback).
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || '',
    get enabled() {
      return !!(this.clientId && this.clientSecret && this.redirectUri);
    },
  },

  // Grup notifikasi transaksi. Kosong = tidak kirim ke grup tsb.
  //  - privateId: detail LENGKAP (monitoring admin)
  //  - publicId : versi DISENSOR, hanya transaksi sukses (social proof)
  groups: {
    privateId: process.env.TRX_GROUP_PRIVATE_ID || '',
    publicId: process.env.TRX_GROUP_PUBLIC_ID || '',
  },

  // Gateway QRIS AutoGoPay. Kosongkan AUTOGOPAY_API_KEY untuk menonaktifkan QRIS.
  qris: {
    apiKey: process.env.AUTOGOPAY_API_KEY || '',
    baseUrl: process.env.AUTOGOPAY_BASE_URL || 'https://v1-gateway.autogopay.site',
    // Fee QRIS yang dibebankan ke member (member yang menanggung fee gateway).
    feeType: (process.env.QRIS_FEE_TYPE || 'flat').toLowerCase(), // flat | percent
    feeValue: Number(process.env.QRIS_FEE_VALUE || 1000),
    feeRound: Number(process.env.QRIS_FEE_ROUND || 100), // bulatkan total ke atas
    pollSec: Number(process.env.QRIS_POLL_INTERVAL_SEC || 3),
    successTtlSec: Number(process.env.QRIS_SUCCESS_TTL_SEC || 15),
    get enabled() {
      return !!this.apiKey;
    },
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
