"use strict";

/**
 * Resolves or rejects like `promise`, but rejects with an Error naming `what` if it takes longer than `ms`. The
 * promise itself is not cancelled; this only stops one that never settles from holding up whatever waits on it.
 */
function withTimeout(promise, ms, what) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)}s`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

module.exports = { withTimeout };
