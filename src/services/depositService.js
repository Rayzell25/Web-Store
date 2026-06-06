'use strict';

const { one, all, query } = require('../db/database');

function now() {
  return Date.now();
}

async function createDeposit(userId, amount) {
  const r = await one(
    `INSERT INTO topups (user_id, amount, status, created_at, updated_at)
     VALUES ($1, $2, 'Pending', $3, $3) RETURNING *`,
    [Number(userId), Math.round(amount), now()]
  );
  return r;
}

function getDeposit(id) {
  return one('SELECT * FROM topups WHERE id = $1', [Number(id)]);
}

async function setDepositStatus(id, status, note) {
  await query(
    'UPDATE topups SET status = $1, note = $2, updated_at = $3 WHERE id = $4',
    [status, note || null, now(), Number(id)]
  );
  return getDeposit(id);
}

function pendingDeposits(limit = 20) {
  return all(
    "SELECT * FROM topups WHERE status = 'Pending' ORDER BY created_at ASC LIMIT $1",
    [limit]
  );
}

function userDeposits(userId, limit = 10) {
  return all(
    'SELECT * FROM topups WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [Number(userId), limit]
  );
}

/** Total nominal top up yang sudah di-approve (akumulasi seumur hidup). */
async function totalApprovedDeposits(userId) {
  const r = await one(
    "SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM topups WHERE user_id = $1 AND status = 'Approved'",
    [Number(userId)]
  );
  return Number(r.total);
}

module.exports = {
  createDeposit,
  getDeposit,
  setDepositStatus,
  pendingDeposits,
  userDeposits,
  totalApprovedDeposits,
};
