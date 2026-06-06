'use strict';

/**
 * Registry token pendek untuk callback_data Telegram (maks 64 byte).
 * Nama kategori/brand bisa panjang, jadi kita simpan nilainya dan kirim token pendek.
 */
const valueToToken = new Map();
const tokenToValue = new Map();
let counter = 0;

function tokenFor(value) {
  const key = String(value);
  if (valueToToken.has(key)) return valueToToken.get(key);
  counter += 1;
  const token = 't' + counter.toString(36);
  valueToToken.set(key, token);
  tokenToValue.set(token, key);
  return token;
}

function valueOf(token) {
  return tokenToValue.get(token);
}

module.exports = { tokenFor, valueOf };
