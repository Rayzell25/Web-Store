'use strict';

const { db } = require('../db/database');

function now() {
  return Date.now();
}

function createTopup(userId, amount) {
  const info = db
    .prepare(
      `INSERT INTO topups (user_id, amount, status, created_at, updated_at)
       VALUES (?, ?, 'Pending', ?, ?)`
    )
    .run(Number(userId), Math.round(amount), now(), now());
  return getTopup(info.lastInsertRowid);
}

function getTopup(id) {
  return db.prepare('SELECT * FROM topups WHERE id = ?').get(Number(id));
}

function setTopupStatus(id, status, note) {
  db.prepare(
    'UPDATE topups SET status = ?, note = ?, updated_at = ? WHERE id = ?'
  ).run(status, note || null, now(), Number(id));
  return getTopup(id);
}

function pendingTopups(limit = 20) {
  return db
    .prepare(
      "SELECT * FROM topups WHERE status = 'Pending' ORDER BY created_at ASC LIMIT ?"
    )
    .all(limit);
}

function userTopups(userId, limit = 10) {
  return db
    .prepare(
      'SELECT * FROM topups WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    )
    .all(Number(userId), limit);
}

module.exports = {
  createTopup,
  getTopup,
  setTopupStatus,
  pendingTopups,
  userTopups,
};
