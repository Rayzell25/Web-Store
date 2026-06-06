'use strict';

const { db } = require('../db/database');

function now() {
  return Date.now();
}

function createDeposit(userId, amount) {
  const info = db
    .prepare(
      `INSERT INTO topups (user_id, amount, status, created_at, updated_at)
       VALUES (?, ?, 'Pending', ?, ?)`
    )
    .run(Number(userId), Math.round(amount), now(), now());
  return getDeposit(info.lastInsertRowid);
}

function getDeposit(id) {
  return db.prepare('SELECT * FROM topups WHERE id = ?').get(Number(id));
}

function setDepositStatus(id, status, note) {
  db.prepare(
    'UPDATE topups SET status = ?, note = ?, updated_at = ? WHERE id = ?'
  ).run(status, note || null, now(), Number(id));
  return getDeposit(id);
}

function pendingDeposits(limit = 20) {
  return db
    .prepare(
      "SELECT * FROM topups WHERE status = 'Pending' ORDER BY created_at ASC LIMIT ?"
    )
    .all(limit);
}

function userDeposits(userId, limit = 10) {
  return db
    .prepare(
      'SELECT * FROM topups WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    )
    .all(Number(userId), limit);
}

module.exports = {
  createDeposit,
  getDeposit,
  setDepositStatus,
  pendingDeposits,
  userDeposits,
};
