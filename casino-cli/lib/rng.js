// lib/rng.js
const crypto = require("crypto");

/** Deterministic RNG stream using SHA-256(serverSeed:nonce:counter) → float in [0,1) */
function makeStream(serverSeed = crypto.randomBytes(32).toString("hex"), nonce = 0) {
  let counter = 0;
  return function nextFloat() {
    const input = `${serverSeed}:${nonce}:${counter++}`;
    const hash = crypto.createHash("sha256").update(input).digest();
    const n =
      (hash[0] * 2 ** 40) +
      (hash[1] * 2 ** 32) +
      (hash[2] * 2 ** 24) +
      (hash[3] * 2 ** 16) +
      (hash[4] * 2 ** 8) +
      hash[5];
    return n / 2 ** 48;
  };
}

/** Map nextFloat() to an integer in [0, maxExclusive) */
function nextInt(nextFloat, maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) throw new Error("maxExclusive must be a positive integer");
  return Math.floor(nextFloat() * maxExclusive);
}

module.exports = { makeStream, nextInt };
