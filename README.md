# Friends Sportsbook (Play Money)
This is a **play-money** sportsbook for you and your friends. It shows **real betting lines** via The Odds API, but all wagers are for **fake credits only**.

## Quick Start
1. Install Node.js (v18+).
2. Download and unzip this project.
3. Create a file named `.env` in the project folder with:
```
ODDS_API_KEY=YOUR_KEY_HERE
```
   Get a free key at https://the-odds-api.com/ (sign up, copy your key).

4. In the project folder, run:
```
npm install
node server.js
```
5. Open http://localhost:3000 in your browser.

## Notes
- Balances and bets are stored in your browser (localStorage).
- The app attempts best-effort auto-settlement if your key has score access enabled.
- This is **not** a real-money gambling site. Do not accept deposits or pay out cash.
