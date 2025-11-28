// games/roulette.js
const { makeStream, nextInt } = require("../lib/rng");
const { ask, toMoney, parseMoney } = require("../lib/utils");

const REDS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

function colorOf(n) {
  if (n === 0) return "green";
  return REDS.has(n) ? "red" : "black";
}

function payoutMultipleFor(bet) {
  switch (bet.type) {
    case "straight": return 35;
    case "red":
    case "black":
    case "odd":
    case "even": return 1;
    case "dozen": return 2;
    default: throw new Error("Unknown bet type");
  }
}

function betWins(bet, spin) {
  const c = colorOf(spin);
  switch (bet.type) {
    case "straight": return spin === bet.number;
    case "red": return c === "red";
    case "black": return c === "black";
    case "odd": return spin !== 0 && (spin % 2 === 1);
    case "even": return spin !== 0 && (spin % 2 === 0);
    case "dozen":
      if (spin === 0) return false;
      if (bet.bucket === 1) return spin >= 1 && spin <= 12;
      if (bet.bucket === 2) return spin >= 13 && spin <= 24;
      if (bet.bucket === 3) return spin >= 25 && spin <= 36;
      return false;
    default:
      return false;
  }
}

async function collectBets(wallet, tableMin = 1, tableMax = 500) {
  const bets = [];
  console.log(`\nPlace your bets (min ${toMoney(tableMin)}, max ${toMoney(tableMax)}).`);
  console.log("Types: straight, red, black, odd, even, dozen");
  console.log("Leave type empty and press ENTER to spin.");

  while (true) {
    const type = (await ask("\nBet type: ")).toLowerCase();
    if (!type) break;

    if (!["straight","red","black","odd","even","dozen"].includes(type)) {
      console.log("Invalid type.");
      continue;
    }

    const payload = {};
    if (type === "straight") {
      const raw = await ask("Pick a number (0-36): ");
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 36) { console.log("Invalid number."); continue; }
      payload.number = n;
    } else if (type === "dozen") {
      const raw = await ask("Dozen (1=1-12, 2=13-24, 3=25-36): ");
      const bucket = Number(raw);
      if (![1,2,3].includes(bucket)) { console.log("Invalid dozen."); continue; }
      payload.bucket = bucket;
    }

    const amtInput = await ask("Amount $: ");
    const amt = parseMoney(amtInput);
    if (!Number.isFinite(amt) || amt < tableMin || amt > tableMax) { console.log("Invalid amount."); continue; }
    if (amt > wallet.balance) { console.log("Insufficient balance."); continue; }

    wallet.debit(amt);
    bets.push({ type, amount: amt, ...payload });
    console.log(`Added ${type} for ${toMoney(amt)} (balance: ${toMoney(wallet.balance)})`);
  }
  return bets;
}

function spinNumber(nextFloat) { return nextInt(nextFloat, 37); }

function settleBets(bets, spin) {
  let totalPayout = 0; const rows = [];
  for (const b of bets) {
    const hit = betWins(b, spin);
    if (hit) {
      const multi = payoutMultipleFor(b);
      const payout = b.amount * (multi + 1); // stake + winnings
      totalPayout += payout;
      rows.push({ bet: b.type, number: b.number ?? "", dozen: b.bucket ?? "", amount: toMoney(b.amount), result: "WIN", payout: toMoney(payout) });
    } else {
      rows.push({ bet: b.type, number: b.number ?? "", dozen: b.bucket ?? "", amount: toMoney(b.amount), result: "LOSE", payout: toMoney(0) });
    }
  }
  return { totalPayout, rows };
}

async function playRound(wallet, serverSeed, nonce) {
  console.clear();
  console.log("🎰  ROULETTE — European (single zero)");
  console.log(`Balance: ${toMoney(wallet.balance)}`);

  const bets = await collectBets(wallet);
  const nextFloat = makeStream(serverSeed, nonce);
  const spin = spinNumber(nextFloat);
  const col = colorOf(spin);

  console.log(`\n🌀  RESULT: ${spin} (${col})`);

  const { totalPayout, rows } = settleBets(bets, spin);
  if (totalPayout > 0) wallet.credit(totalPayout);

  if (rows.length) {
    console.log("\nSettlement:");
    const headers = ["bet","number","dozen","amount","result","payout"]; const widths = [10,8,8,10,8,10];
    console.log(headers.map((h,i)=>h.padEnd(widths[i]," ")).join(" | "));
    console.log("-".repeat(widths.reduce((a,b)=>a+b,0) + (headers.length-1) * 3));
    for (const r of rows) {
      const vals = [r.bet, String(r.number), String(r.dozen), r.amount, r.result, r.payout];
      console.log(vals.map((v,i)=>v.padEnd(widths[i]," ")).join(" | "));
    }
  } else {
    console.log("\n(No bets were placed.)");
  }

  console.log(`\nPaid this round: ${toMoney(totalPayout)}`);
  console.log(`Balance: ${toMoney(wallet.balance)}\n`);

  return { spin, color: col, rows };
}

module.exports = { playRound };
