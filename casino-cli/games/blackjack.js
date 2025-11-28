// games/blackjack.js
const { makeStream } = require("../lib/rng");
const { ask, toMoney } = require("../lib/utils");
const { freshDeck, drawOne, bjValue, isBlackjack, cardStr } = require("../lib/deck");

function handStr(h) { return h.map(cardStr).join(" "); }

function soft17(dealer) {
  let total = 0, aces=0;
  for (const c of dealer) { total += c.r >= 10 ? 10 : c.r; if (c.r===1) aces++; }
  while (aces && total + 10 <= 21) { total += 10; aces--; }
  let raw = dealer.reduce((a,c)=>a+(c.r>=10?10:c.r),0);
  return dealer.some(c=>c.r===1) && raw+10===17;
}

async function playRound(wallet, serverSeed, nonce, tableMin=5, tableMax=500) {
  console.clear();
  console.log("🃏  BLACKJACK — 6-deck, Dealer S17, no splits/insurance");
  console.log(`Balance: ${toMoney(wallet.balance)}`);

  const bet = Number(await ask(`Bet amount (${toMoney(tableMin)}—${toMoney(tableMax)}): $`));
  if (!Number.isFinite(bet) || bet < tableMin || bet > tableMax || bet > wallet.balance) { console.log("Invalid bet."); return; }
  wallet.debit(bet);
  let actualBet = bet;

  const nextFloat = makeStream(serverSeed, `bj-${nonce}`);
  let deck = []; for (let i=0;i<6;i++) deck = deck.concat(freshDeck());

  const player = [drawOne(deck, nextFloat), drawOne(deck, nextFloat)];
  const dealer = [drawOne(deck, nextFloat), drawOne(deck, nextFloat)];

  console.log(`\nDealer: ${cardStr(dealer[0])} ??`);
  console.log(`You   : ${handStr(player)}  (=${bjValue(player)})`);

  const pBJ = isBlackjack(player); const dBJ = isBlackjack(dealer);
  if (pBJ || dBJ) {
    console.log(`\nDealer reveals: ${handStr(dealer)} (=${bjValue(dealer)})`);
    if (pBJ && !dBJ) { const payout = bet * 2.5; wallet.credit(payout); console.log(`Blackjack! You win ${toMoney(payout - bet)}. Balance: ${toMoney(wallet.balance)}`); }
    else if (!pBJ && dBJ) { console.log(`Dealer blackjack. You lose ${toMoney(bet)}. Balance: ${toMoney(wallet.balance)}`); }
    else { wallet.credit(bet); console.log(`Both blackjack — push. Balance: ${toMoney(wallet.balance)}`); }
    return;
  }

  let firstDecision = true;
  while (true) {
    const val = bjValue(player);
    if (val > 21) { console.log("\nYou bust."); break; }
    const canDouble = firstDecision && wallet.balance >= bet;
    const action = (await ask(`\nAction [h=hit, s=stand${canDouble ? ", d=double" : ""}]: `)).toLowerCase();

    if (action === "h") {
      player.push(drawOne(deck, nextFloat));
      console.log(`You: ${handStr(player)} (=${bjValue(player)})`);
    } else if (action === "d" && canDouble) {
      wallet.debit(bet); actualBet += bet;
      player.push(drawOne(deck, nextFloat));
      console.log(`You (double): ${handStr(player)} (=${bjValue(player)})`);
      break;
    } else if (action === "s") {
      break;
    } else {
      console.log("Invalid action."); continue;
    }
    firstDecision = false;
  }

  const playerVal = bjValue(player);
  console.log(`\nDealer reveals: ${handStr(dealer)} (=${bjValue(dealer)})`);
  while (bjValue(dealer) < 17 || (bjValue(dealer) === 17 && soft17(dealer))) {
    dealer.push(drawOne(deck, nextFloat));
    console.log(`Dealer hits: ${handStr(dealer)} (=${bjValue(dealer)})`);
  }

  const dealerVal = bjValue(dealer);
  let outcome;
  if (playerVal > 21) outcome = "lose";
  else if (dealerVal > 21) outcome = "win";
  else if (playerVal > dealerVal) outcome = "win";
  else if (playerVal < dealerVal) outcome = "lose";
  else outcome = "push";

  if (outcome === "win") {
    const payout = actualBet * 2;
    wallet.credit(payout);
    console.log(`\nYou win ${toMoney(payout - actualBet)}. Balance: ${toMoney(wallet.balance)}`);
  } else if (outcome === "push") {
    wallet.credit(actualBet);
    console.log(`\nPush. Your ${toMoney(actualBet)} is returned. Balance: ${toMoney(wallet.balance)}`);
  } else {
    console.log(`\nYou lose ${toMoney(actualBet)}. Balance: ${toMoney(wallet.balance)}`);
  }
}

module.exports = { playRound };
