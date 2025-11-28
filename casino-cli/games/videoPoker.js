// games/videoPoker.js
const { makeStream } = require("../lib/rng");
const { ask, toMoney } = require("../lib/utils");
const { freshDeck, drawOne, cardStr } = require("../lib/deck");

function handStr(h) { return h.map(cardStr).join(" "); }
function rankCounts(hand) { const map = new Map(); for (const c of hand) map.set(c.r, (map.get(c.r)||0)+1); return map; }
function isFlush(hand) { return hand.every(c => c.s === hand[0].s); }
function isStraight(hand) {
  const ranks = hand.map(c=>c.r).sort((a,b)=>a-b);
  const uniq = [...new Set(ranks)]; if (uniq.length !== 5) return false;
  const asHigh = ranks.map(r=> r===1 ? 14 : r).sort((a,b)=>a-b);
  const check = (arr)=> arr[4]-arr[0]===4 && arr.every((v,i)=> i===0 || v-arr[i-1]===1);
  return check(ranks) || check(asHigh);
}
function isRoyal(hand) {
  if (!isFlush(hand)) return false;
  const set = new Set(hand.map(c=> c.r===1 ? 14 : c.r));
  for (const v of [10,11,12,13,14]) if (!set.has(v)) return false;
  return true;
}
function scoreJacksOrBetter(hand) {
  const flush = isFlush(hand); const straight = isStraight(hand);
  if (isRoyal(hand)) return { name: "Royal Flush", mult: 250 };
  if (flush && straight) return { name: "Straight Flush", mult: 50 };
  const counts = [...rankCounts(hand).values()].sort((a,b)=>b-a);
  if (counts[0] === 4) return { name: "Four of a Kind", mult: 25 };
  if (counts[0] === 3 && counts[1] === 2) return { name: "Full House", mult: 9 };
  if (flush) return { name: "Flush", mult: 6 };
  if (straight) return { name: "Straight", mult: 4 };
  if (counts[0] === 3) return { name: "Three of a Kind", mult: 3 };
  if (counts[0] === 2 && counts[1] === 2) return { name: "Two Pair", mult: 2 };
  if (counts[0] === 2) { const pairRank = [...rankCounts(hand).entries()].find(([,v])=>v===2)[0]; const high = pairRank === 1 ? 14 : pairRank; if (high >= 11) return { name: "Jacks or Better", mult: 1 }; }
  return { name: "No Win", mult: 0 };
}

async function playRound(wallet, serverSeed, nonce, minBet=1, maxBet=25) {
  console.clear();
  console.log("🎰  VIDEO POKER — Jacks or Better (9/6)");
  console.log(`Balance: ${toMoney(wallet.balance)}`);

  const bet = Number(await ask(`Bet (${toMoney(minBet)}—${toMoney(maxBet)}): $`));
  if (!Number.isFinite(bet) || bet < minBet || bet > maxBet || bet > wallet.balance) { console.log("Invalid bet."); return; }
  wallet.debit(bet);

  const nextFloat = makeStream(serverSeed, `vp-${nonce}`);
  let deck = freshDeck();

  let hand = [drawOne(deck,nextFloat), drawOne(deck,nextFloat), drawOne(deck,nextFloat), drawOne(deck,nextFloat), drawOne(deck,nextFloat)];
  console.log(`\nDealt: ${handStr(hand)}`);
  console.log("Type positions to HOLD separated by spaces, e.g., 1 3 5. ENTER for none.");
  const holdInp = (await ask("Holds: ")).trim();
  const holds = new Set(holdInp ? holdInp.split(/\s+/).map(x=>Number(x)).filter(n=>n>=1 && n<=5) : []);

  const newHand = [];
  for (let i=0;i<5;i++) { if (holds.has(i+1)) newHand.push(hand[i]); else newHand.push(drawOne(deck,nextFloat)); }
  hand = newHand;

  console.log(`Final : ${handStr(hand)}`);
  const result = scoreJacksOrBetter(hand);
  const payout = result.mult > 0 ? bet * (result.mult + 1) : 0;
  if (payout > 0) wallet.credit(payout);

  console.log(`Result: ${result.name} — ${result.mult}x`);
  if (result.mult > 0) console.log(`You win ${toMoney(payout - bet)}. Balance: ${toMoney(wallet.balance)}`);
  else console.log(`No win. Balance: ${toMoney(wallet.balance)}`);
}

module.exports = { playRound };
