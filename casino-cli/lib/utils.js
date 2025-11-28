// lib/utils.js
const readline = require("readline");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(prompt) {
  return new Promise((resolve) => rl.question(prompt, (ans) => resolve(ans.trim())));
}

function closeRL() {
  try { rl.close(); } catch {}
}

function toMoney(n) {
  const x = Number(n);
  return Number.isFinite(x) ? `$${x.toFixed(2)}` : "$0.00";
}

function parseMoney(input) {
  const cleaned = String(input).replace(/[^0-9.\-]/g, "");
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return NaN;
  return Math.round(num * 100) / 100;
}

async function pause(msg = "Press ENTER to continue...") {
  await ask(`\n${msg}`);
}

module.exports = { ask, closeRL, toMoney, parseMoney, pause };

