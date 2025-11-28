// index.js
const crypto = require("crypto");
const { Wallet } = require("./lib/wallet");
const { ask, pause, toMoney, closeRL } = require("./lib/utils");
const roulette = require("./games/roulette");
const blackjack = require("./games/blackjack");
const baccarat = require("./games/baccarat");
const videoPoker = require("./games/videoPoker");

async function main() {
  const wallet = new Wallet(1000);
  const serverSeed = crypto.randomBytes(32).toString("hex");
  let nonce = 0;

  while (true) {
    console.clear();
    console.log("🎲  CASINO CLI (single-player)");
    console.log("-----------------------------");
    console.log("1) Roulette");
    console.log("2) Blackjack");
    console.log("3) Baccarat");
    console.log("4) Video Poker");
    console.log("Q) Quit");
    console.log("-----------------------------");
    console.log(`Balance: ${toMoney(wallet.balance)}\n`);

    const choice = (await ask("Choose: ")).toLowerCase();

    if (choice === "1") { await roulette.playRound(wallet, serverSeed, nonce++); await pause(); }
    else if (choice === "2") { await blackjack.playRound(wallet, serverSeed, nonce++); await pause(); }
    else if (choice === "3") { await baccarat.playRound(wallet, serverSeed, nonce++); await pause(); }
    else if (choice === "4") { await videoPoker.playRound(wallet, serverSeed, nonce++); await pause(); }
    else if (choice === "q") { console.log("\nBye!"); break; }
    else { console.log("Invalid choice."); await pause(); }
  }
}

main()
  .catch((err) => { console.error("\nFatal error:", err); })
  .finally(() => { closeRL(); process.exit(0); });
