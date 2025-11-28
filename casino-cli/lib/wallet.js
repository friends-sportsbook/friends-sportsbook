// lib/wallet.js
class Wallet {
  constructor(startingBalance = 1000) {
    this.balance = Number(startingBalance) || 0;
  }
  canBet(amount) {
    return Number.isFinite(amount) && amount > 0 && amount <= this.balance;
  }
  debit(amount) {
    if (!this.canBet(amount)) throw new Error("Insufficient funds or invalid bet amount.");
    this.balance -= amount;
  }
  credit(amount) {
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid credit amount.");
    this.balance += amount;
  }
}
module.exports = { Wallet };
