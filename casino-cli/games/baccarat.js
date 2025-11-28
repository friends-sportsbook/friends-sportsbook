// games/baccarat.js
const { makeStream } = require("../lib/rng");
const { ask, toMoney } = require("../lib/utils");
const { freshDeck, drawOne, bacTotal, bacVal, cardStr } = require("../lib/deck");

function handStr(h) { return h.map(cardStr).join(" "); }

async function playRound(wallet, serverSeed, nonce, tableMin=5, tableMax=1000) {
  console.clear();
  console.log("🎴  BACCARAT — Banker/Player/Tie (5% commission on Banker)");
  console.log(`Balance: ${toMoney(wallet.balance)}`);
  console.log("Bet types: banker, player, tie");

  const type = (await ask("Bet on [banker/player/tie]: ")).toLowerCase();
  if (!["banker","player","tie"].includes(type)) { console.log("Invalid bet."); return; }
  const amt = Number(await ask(`Amount (${toMoney(tableMin)}—${toMoney(tableMax)}): $`));
  if (!Number.isFinite(amt) || amt < tableMin || amt > tableMax || amt > wallet.balance) { console.log("Invalid amount."); return; }
  wallet.debit(amt);

  const nextFloat = makeStream(serverSeed, `bac-${nonce}`);
  let deck = []; for (let i=0;i<8;i++) deck = deck.concat(freshDeck());

  const player = [drawOne(deck, nextFloat), drawOne(deck, nextFloat)];
  const banker = [drawOne(deck, nextFloat), drawOne(deck, nextFloat)];

  let pTot = bacTotal(player); let bTot = bacTotal(banker);
  console.log(`\nPlayer: ${handStr(player)} (=${pTot})`);
  console.log(`Banker: ${cardStr(banker[0])} ??`);

  if (pTot >= 8 || bTot >= 8) {
    console.log(`\nNatural — no draw.`);
  } else {
    let playerThird = null;
    if (pTot <= 5) {
      playerThird = drawOne(deck, nextFloat);
      player.push(playerThird);
      pTot = bacTotal(player);
      console.log(`Player draws: ${cardStr(playerThird)} → ${pTot}`);
    }
    bTot = bacTotal(banker);
    if (playerThird === null) {
      if (bTot <= 5) {
        const c = drawOne(deck, nextFloat);
        banker.push(c); bTot = bacTotal(banker);
        console.log(`Banker draws: ${cardStr(c)} → ${bTot}`);
      }
    } else {
      const pv = bacVal(playerThird);
      if (bTot <= 2) { const c = drawOne(deck, nextFloat); banker.push(c); bTot = bacTotal(banker); console.log(`Banker draws: ${cardStr(c)} → ${bTot}`); }
      else if (bTot === 3 && pv !== 8) { const c = drawOne(deck, nextFloat); banker.push(c); bTot = bacTotal(banker); console.log(`Banker draws: ${cardStr(c)} → ${bTot}`); }
      else if (bTot === 4 && pv >= 2 && pv <= 7) { const c = drawOne(deck, nextFloat); banker.push(c); bTot = bacTotal(banker); console.log(`Banker draws: ${cardStr(c)} → ${bTot}`); }
      else if (bTot === 5 && pv >= 4 && pv <= 7) { const c = drawOne(deck, nextFloat); banker.push(c); bTot = bacTotal(banker); console.log(`Banker draws: ${cardStr(c)} → ${bTot}`); }
      else if (bTot === 6 && (pv === 6 || pv === 7)) { const c = drawOne(deck, nextFloat); banker.push(c); bTot = bacTotal(banker); console.log(`Banker draws: ${cardStr(c)} → ${bTot}`); }
    }
  }

  console.log(`\nFinal Hands:`);
  console.log(`Player: ${handStr(player)} (=${bacTotal(player)})`);
  console.log(`Banker: ${handStr(banker)} (=${bacTotal(banker)})`);

  const finalP = bacTotal(player); const finalB = bacTotal(banker);
  const outcome = (finalP === finalB) ? "tie" : (finalP > finalB ? "player" : "banker");

  if (type === "tie") {
    if (outcome === "tie") { const payout = amt * 9; wallet.credit(amt + (payout - amt)); console.log(`Tie! You win ${toMoney(payout - amt)}. Balance: ${toMoney(wallet.balance)}`); }
    else { console.log(`Loss. Balance: ${toMoney(wallet.balance)}`); }
  } else if (type === "player") {
    if (outcome === "player") { wallet.credit(amt * 2); console.log(`Player wins. You win ${toMoney(amt)}. Balance: ${toMoney(wallet.balance)}`); }
    else if (outcome === "tie") { wallet.credit(amt); console.log(`Push on tie. Stake returned. Balance: ${toMoney(wallet.balance)}`); }
    else { console.log(`Loss. Balance: ${toMoney(wallet.balance)}`); }
  } else {
    if (outcome === "banker") { const win = amt * 0.95; wallet.credit(amt + win); console.log(`Banker wins. You win ${toMoney(win)} (after 5% commission). Balance: ${toMoney(wallet.balance)}`); }
    else if (outcome === "tie") { wallet.credit(amt); console.log(`Push on tie. Stake returned. Balance: ${toMoney(wallet.balance)}`); }
    else { console.log(`Loss. Balance: ${toMoney(wallet.balance)}`); }
  }
}

module.exports = { playRound };
