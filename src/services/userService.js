'use strict';

const { one, all, query, withTx } = require('../db/database');
const { isAdmin } = require('../config');

function now() {
  return Date.now();
}

/** Ambil user, buat baru jika belum ada (sinkron profil). */
async function ensureUser(from) {
  const id = Number(from.id);
  const name =
    [from.first_name, from.last_name].filter(Boolean).join(' ') ||
    from.username ||
    'User';
  const username = from.username || null;
  const existing = await one('SELECT * FROM users WHERE id = $1', [id]);

  if (!existing) {
    const role = isAdmin(id) ? 'ADMIN' : 'MEMBER';
    await query(
      `INSERT INTO users (id, username, name, balance, role, banned, created_at, updated_at)
       VALUES ($1, $2, $3, 0, $4, FALSE, $5, $5)`,
      [id, username, name, role, now()]
    );
    return one('SELECT * FROM users WHERE id = $1', [id]);
  }

  const role = isAdmin(id) ? 'ADMIN' : existing.role;
  await query(
    'UPDATE users SET username = $1, name = $2, role = $3, updated_at = $4 WHERE id = $5',
    [username, name, role, now(), id]
  );
  return one('SELECT * FROM users WHERE id = $1', [id]);
}

function getUser(id) {
  return one('SELECT * FROM users WHERE id = $1', [Number(id)]);
}

async function getBalance(id) {
  const u = await getUser(id);
  return u ? u.balance : 0;
}

/** Tambah/kurang saldo secara atomik (row lock). amount boleh negatif. */
function addBalance(id, amount) {
  const uid = Number(id);
  const amt = Math.round(amount);
  return withTx(async (client) => {
    const r = await client.query(
      'SELECT balance FROM users WHERE id = $1 FOR UPDATE',
      [uid]
    );
    if (!r.rows[0]) throw new Error('User tidak ditemukan');
    const next = Number(r.rows[0].balance) + amt;
    if (next < 0) throw new Error('Saldo tidak cukup');
    await client.query(
      'UPDATE users SET balance = $1, updated_at = $2 WHERE id = $3',
      [next, now(), uid]
    );
    return next;
  });
}

async function setRole(id, role) {
  await query('UPDATE users SET role = $1, updated_at = $2 WHERE id = $3', [
    role,
    now(),
    Number(id),
  ]);
}

async function setBanned(id, banned) {
  await query('UPDATE users SET banned = $1, updated_at = $2 WHERE id = $3', [
    !!banned,
    now(),
    Number(id),
  ]);
}

async function countUsers() {
  const r = await one('SELECT COUNT(*)::int AS c FROM users');
  return r.c;
}

async function allUserIds() {
  const rows = await all('SELECT id FROM users WHERE banned = FALSE');
  return rows.map((r) => r.id);
}

module.exports = {
  ensureUser,
  getUser,
  getBalance,
  addBalance,
  setRole,
  setBanned,
  countUsers,
  allUserIds,
};
