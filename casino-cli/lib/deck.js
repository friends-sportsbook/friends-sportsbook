// lib/deck.js
const { nextInt } = require("./rng");

const SUITS = ["C","D","H","S"];
const RANKS = [1,2,3,4,5,6,7,8,9,10,11,12,13];

function freshDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
  return deck;
}

function drawOne(deck, nextFloat) {
  if (!deck.length) throw new Error("Deck exhausted");
  const i = nextInt(nextFloat, deck.length);
  const [card] = deck.splice(i, 1);
  return card;
}

function drawMany(deck, n, nextFloat) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(drawOne(deck, nextFloat));
  return out;
}

// Blackjack values
function bjValue(cards) {
  let total = 0, aces = 0;
  for (const c of cards) {
    total += c.r >= 10 ? 10 : c.r;
    if (c.r === 1) aces++;
  }
  while (aces && total + 10 <= 21) { total += 10; aces--; }
  return total;
}
function isBlackjack(cards) {
  return cards.length === 2 && bjValue(cards) === 21;
}

// Baccarat values (A=1, 2–9 face, 10/J/Q/K=0); totals mod 10
function bacVal(card) {
  if (card.r === 1) return 1;
  if (card.r >= 10) return 0;
  return card.r;
}
function bacTotal(cards) {
  const sum = cards.reduce((a,c)=>a+bacVal(c),0);
  return sum % 10;
}

function cardStr(c) {
  const rankMap = {1:"A",11:"J",12:"Q",13:"K"};
  const rs = rankMap[c.r] || String(c.r);
  return `${rs}${c.s}`;
}

module.exports = {
  freshDeck, drawOne, drawMany, bjValue, isBlackjack, bacVal, bacTotal, cardStr
};
