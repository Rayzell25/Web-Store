'use strict';

const { db } = require('../db/database');
const { isAdmin } = require('../config');

function now() {
  return Date.now();
}

/** Ambil user, buat baru jika belum ada (upsert profil dasar) */
function ensureUser(from) {
  const id = Number(from.id);
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'User';
  const username = from.username || null;

  if (!existing) {
    const role = isAdmin(id) ? 'ADMIN' : 'MEMBER';
    db.prepare(
      `INSERT INTO users (id, username, name, balance, role, banned, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, 0, ?, ?)`
    ).run(id, username, name, role, now(), now());
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }

  // sinkronkan profil + pastikan admin selalu role ADMIN
  const role = isAdmin(id) ? 'ADMIN' : existing.role;
  db.prepare(
    'UPDATE users SET username = ?, name = ?, role = ?, updated_at = ? WHERE id = ?'
  ).run(username, name, role, now(), id);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
}

function getBalance(id) {
  const u = getUser(id);
  return u ? u.balance : 0;
}

/** Tambah/kurang saldo secara atomik. amount boleh negatif. */
function addBalance(id, amount) {
  const tx = db.transaction((uid, amt) => {
    const u = db.prepare('SELECT balance FROM users WHERE id = ?').get(uid);
    if (!u) throw new Error('User tidak ditemukan');
    const next = u.balance + amt;
    if (next < 0) throw new Error('Saldo tidak cukup');
    db.prepare('UPDATE users SET balance = ?, updated_at = ? WHERE id = ?').run(
      next,
      now(),
      uid
    );
    return next;
  });
  return tx(Number(id), Math.round(amount));
}

function setRole(id, role) {
  db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(
    role,
    now(),
    Number(id)
  );
}

function setBanned(id, banned) {
  db.prepare('UPDATE users SET banned = ?, updated_at = ? WHERE id = ?').run(
    banned ? 1 : 0,
    now(),
    Number(id)
  );
}

function countUsers() {
  return db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
}

function allUserIds() {
  return db.prepare('SELECT id FROM users WHERE banned = 0').all().map((r) => r.id);
}

function searchUsers(limit = 20) {
  return db
    .prepare('SELECT * FROM users ORDER BY updated_at DESC LIMIT ?')
    .all(limit);
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
  searchUsers,
};
