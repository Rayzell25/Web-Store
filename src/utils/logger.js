'use strict';

function ts() {
  return new Date().toISOString();
}

const logger = {
  info: (...args) => console.log(`[INFO] ${ts()}`, ...args),
  warn: (...args) => console.warn(`[WARN] ${ts()}`, ...args),
  error: (...args) => console.error(`[ERROR] ${ts()}`, ...args),
  debug: (...args) => {
    if (process.env.DEBUG) console.log(`[DEBUG] ${ts()}`, ...args);
  },
};

module.exports = logger;
