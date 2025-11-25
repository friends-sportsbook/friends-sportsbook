const express = require('express');
// fetch compatibility: use global fetch (Node 18+) or fallback to node-fetch via dynamic import
const fetch = globalThis.fetch || ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));
const dotenv = require('dotenv');
const path = require('path');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { URL } = require('url');

dotenv.config();

const __dirnameSafe = __dirname;

const app = express();
const PORT = process.env.PORT || 3000;
const ODDS_API_KEY = process.env.ODDS_API_KEY || '';

const DATA_DIR = path.join(__dirnameSafe, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(
    USERS_FILE,
    JSON.stringify({ users: [{ username: 'admin', passwordHash: null, role: 'admin', balance: 10000, banned:false, bets: [] }] }, null, 2)
  );
}

function readUsers() { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')); }
function writeUsers(db) { fs.writeFileSync(USERS_FILE, JSON.stringify(db, null, 2)); }

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieSession({ name: 'session', keys: [process.env.SESSION_KEY || 'dev_secret_change_me'], maxAge: 24*60*60*1000 }));

// Static
app.use(express.static(path.join(__dirnameSafe, 'public')));

// Odds API
const DEFAULT_SPORT = 'americanfootball_nfl';
const DEFAULT_REGION = 'us';
const ODDS_FORMAT = 'american';
const BOOKMAKER_ALLOWLIST = { draftkings:1, fanduel:1, betmgm:1, caesars:1, pointsbetus:1 };

// Helpers
function requireAuth(req, res, next){ if(!(req.session && req.session.user)) return res.redirect('/login.html'); next(); }
function requireAdmin(req, res, next){
  if(!(req.session && req.session.user)) return res.status(401).json({ error:'Not logged in' });
  if(req.session.user.role !== 'admin') return res.status(403).json({ error:'Admin only' });
  next();
}
function toDecimal(american){
  const o = Number(american);
  if (!isFinite(o)) return 0;
  return o > 0 ? 1 + o/100 : 1 + 100/Math.abs(o);
}
function decimalToAmerican(dec){
  if (dec <= 1) return 0;
  return dec >= 2 ? Math.round((dec - 1) * 100) : -Math.round(100 / (dec - 1));
}

// -------- Auth ----------
app.get('/api/me', (req, res) => {
  if(!(req.session && req.session.user)) return res.json({ user: null });
  const u = req.session.user;
  res.json({ user: { username: u.username, role: u.role, balance: u.balance, banned: !!u.banned } });
});

// Disable public self-signup entirely
app.post('/api/signup', (req, res) => {
  return res.status(403).json({ error: 'Signup disabled. Ask admin to create an account.' });
});

// Admin creates users
app.post('/api/admin/create-user', requireAdmin, async (req, res) => {
  const username = (req.body && req.body.username || '').trim();
  const password = (req.body && req.body.password) || '';
  const balance = Math.max(0, Math.floor(Number(req.body && req.body.balance || 0)));
  if (!username || !password) return res.status(400).json({ error:'username and password required' });
  if (username.toLowerCase()==='admin') return res.status(400).json({ error:'Reserved username' });
  const db = readUsers();
  if (db.users.find(u=>u.username.toLowerCase()===username.toLowerCase())) return res.status(400).json({ error:'Username already exists' });
  const passwordHash = await bcrypt.hash(password, 10);
  db.users.push({ username, passwordHash, role:'user', balance, banned:false, bets:[] });
  writeUsers(db);
  res.json({ ok:true });
});

app.post('/api/login', async (req, res) => {
  const username = (req.body && req.body.username || '').trim();
  const password = (req.body && req.body.password) || '';
  const db = readUsers();
  const user = db.users.find(u=>u.username.toLowerCase()===username.toLowerCase());
  if (!user || !user.passwordHash) return res.status(400).json({ error:'Invalid credentials' });
  if (user.banned) return res.status(403).json({ error: 'Account is banned' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(400).json({ error:'Invalid credentials' });
  req.session.user = { username:user.username, role:user.role, balance:user.balance, banned:user.banned };
  res.json({ ok:true });
});

app.post('/api/logout', (req,res)=>{ req.session=null; res.json({ ok:true }); });

// -------- Admin ops ----------
app.get('/api/admin/list-users', requireAdmin, (req,res)=>{
  const db = readUsers();
  const rows = db.users.map(u=>({ username:u.username, role:u.role, balance:u.balance, banned:!!u.banned, open:(u.bets||[]).filter(b=>b.status==='open').length }));
  res.json({ users: rows });
});

app.post('/api/admin/set-balance', requireAdmin, (req, res) => {
  const username = (req.body && req.body.username || '').trim();
  const balance = Number(req.body && req.body.balance);
  if (!isFinite(balance)) return res.status(400).json({ error:'Invalid balance' });
  const db = readUsers();
  const user = db.users.find(u=>u.username.toLowerCase()===username.toLowerCase());
  if (!user) return res.status(404).json({ error:'User not found' });
  user.balance = Math.round(balance);
  writeUsers(db);
  if (req.session.user.username.toLowerCase()===user.username.toLowerCase()) req.session.user.balance = user.balance;
  res.json({ ok:true, username:user.username, balance:user.balance });
});

app.post('/api/admin/reset-password', requireAdmin, async (req,res)=>{
  const username = (req.body && req.body.username || '').trim();
  const password = (req.body && req.body.password) || '';
  if (!username || !password) return res.status(400).json({ error:'username and password required' });
  const db = readUsers();
  const user = db.users.find(u=>u.username.toLowerCase()===username.toLowerCase());
  if (!user) return res.status(404).json({ error:'User not found' });
  user.passwordHash = await bcrypt.hash(password, 10);
  writeUsers(db);
  res.json({ ok:true });
});

app.post('/api/admin/ban', requireAdmin, (req,res)=>{
  const username = (req.body && req.body.username || '').trim();
  const banned = !!(req.body && req.body.banned);
  const db = readUsers();
  const user = db.users.find(u=>u.username.toLowerCase()===username.toLowerCase());
  if (!user) return res.status(404).json({ error:'User not found' });
  user.banned = banned;
  writeUsers(db);
  res.json({ ok:true, username:user.username, banned:user.banned });
});

// -------- Bets / Odds ----------
app.get('/api/leaderboard', (req, res) => {
  const db = readUsers();
  const rows = db.users.map(u => ({ username:u.username, balance:u.balance, open:(u.bets||[]).filter(b=>b.status==='open').length }))
                       .sort((a,b)=> b.balance - a.balance);
  res.json({ rows });
});

app.get('/api/my-bets', requireAuth, (req,res) => {
  const db = readUsers();
  const user = db.users.find(u=>u.username.toLowerCase()===req.session.user.username.toLowerCase());
  res.json({ bets: (user && user.bets ? user.bets.slice().reverse() : []) });
});

// Place bet (single, parlay, or round-robin)
app.post('/api/bet', (req, res) => {
  if(!(req.session && req.session.user)) return res.status(401).json({ error:'Not logged in' });
  const db = readUsers();
  const user = db.users.find(u=>u.username.toLowerCase()===req.session.user.username.toLowerCase());
  if (!user) return res.status(401).json({ error:'User missing' });
  if (user.banned) return res.status(403).json({ error:'Account is banned' });

  const parlay = !!(req.body && req.body.parlay);
  const rr = req.body && req.body.rr; // { size, legs }
  const legs = (req.body && req.body.legs) || null;
  const selection = (req.body && req.body.selection) || null;
  const odds = Number(req.body && req.body.odds);
  const stake = Math.max(1, Math.floor(Number(req.body && req.body.stake)));
  const meta = (req.body && req.body.meta) || {};

  if (!isFinite(stake)) return res.status(400).json({ error:'Bad stake' });

  // ROUND ROBIN: creates many parlays (choose rr.size out of legs)
  if (rr && Array.isArray(rr.legs) && Number(rr.size)>=2) {
    const L = rr.legs;
    const k = Math.floor(Number(rr.size));
    if (L.length < k) return res.status(400).json({ error:'Not enough legs for round robin' });

    // combinations helper
    function combos(arr, k, start=0, cur=[], out=[]){
      if (cur.length===k) { out.push(cur.slice()); return out; }
      for (let i=start;i<arr.length;i++) combos(arr, k, i+1, cur.concat(arr[i]), out);
      return out;
    }
    const sets = combos(L, k);
    const totalStake = sets.length * stake;
    if (user.balance < totalStake) return res.status(400).json({ error:`Insufficient balance (need $${totalStake})` });

    user.bets = user.bets || [];
    for (const legsSet of sets) {
      let dec = 1;
      for (const lg of legsSet) dec *= toDecimal(Number(lg.odds));
      const combined = decimalToAmerican(dec);
      user.balance -= stake;
      user.bets.push({ id: uuidv4(), type:'parlay', combinedOdds: combined, stake, status:'open', legs: legsSet, meta:{ createdAt: Date.now(), rr:true, size:k } });
    }
    writeUsers(db);
    req.session.user.balance = user.balance;
    return res.json({ ok:true, balance:user.balance, placed: sets.length });
  }

  // Regular single or parlay
  if (parlay) {
    if (!Array.isArray(legs) || legs.length < 2) return res.status(400).json({ error:'Parlay needs 2+ legs' });
    if (user.balance < stake) return res.status(400).json({ error:'Insufficient balance' });
    let dec = 1;
    for (let i=0;i<legs.length;i++){
      const lg = legs[i];
      if (!lg || !lg.selection || !isFinite(Number(lg.odds))) return res.status(400).json({ error:'Bad leg' });
      dec *= toDecimal(Number(lg.odds));
    }
    const combined = decimalToAmerican(dec);
    user.balance -= stake;
    const bet = { id: uuidv4(), type:'parlay', combinedOdds: combined, stake, status:'open', legs, meta:{ createdAt: Date.now() } };
    user.bets = user.bets || [];
    user.bets.push(bet);
    writeUsers(db);
    req.session.user.balance = user.balance;
    return res.json({ ok:true, balance:user.balance, bet });
  } else {
    if (!selection || !isFinite(odds)) return res.status(400).json({ error:'Invalid bet' });
    if (user.balance < stake) return res.status(400).json({ error:'Insufficient balance' });
    user.balance -= stake;
    const bet = { id: uuidv4(), type:'single', selection, odds, stake, status:'open', meta: meta };
    user.bets = user.bets || [];
    user.bets.push(bet);
    writeUsers(db);
    req.session.user.balance = user.balance;
    return res.json({ ok:true, balance:user.balance, bet });
  }
});

// -------- Auto-settle with push handling ----------
app.post('/api/settle-open', requireAuth, async (req, res) => {
  if (!ODDS_API_KEY) return res.status(500).json({ error:'Missing ODDS_API_KEY in .env' });
  const db = readUsers();
  const user = db.users.find(u=>u.username.toLowerCase()===req.session.user.username.toLowerCase());
  if (!user) return res.status(401).json({ error:'User missing' });

  let settled = 0, wins = 0, losses = 0, pushes = 0;
  const openBets = (user.bets||[]).filter(b=>b.status==='open');

  // collect ids by sport
  const bySport = {};
  function addMap(sport, id){
    if (!sport || !id) return;
    if (!bySport[sport]) bySport[sport] = {};
    bySport[sport][id] = 1;
  }
  for (let i=0;i<openBets.length;i++){
    const b = openBets[i];
    if (b.type==='single') addMap((b.meta && b.meta.sport) || DEFAULT_SPORT, b.meta && b.meta.eventId);
    if (b.type==='parlay' && Array.isArray(b.legs)) {
      for (let j=0;j<b.legs.length;j++){
        const lg = b.legs[j];
        addMap((lg.meta && lg.meta.sport) || DEFAULT_SPORT, lg.meta && lg.meta.eventId);
      }
    }
  }

  const scoreMap = {};
  const sports = Object.keys(bySport);
  for (let i=0;i<sports.length;i++){
    const sport = sports[i];
    try {
      const url = new URL(`https://api.the-odds-api.com/v4/sports/${sport}/scores`);
      url.searchParams.set('daysFrom', '3');
      url.searchParams.set('apiKey', ODDS_API_KEY);
      const r = await fetch(url);
      if (!r.ok) continue;
      const arr = await r.json();
      for (let k=0;k<arr.length;k++) scoreMap[arr[k].id] = arr[k];
    } catch {}
  }

  function getScores(scoreObj){
    const h = scoreObj.home_team, a = scoreObj.away_team;
    let hs = 0, as = 0;
    if (Array.isArray(scoreObj.scores) && scoreObj.scores.length>=2){
      // try to map by name
      const sh = scoreObj.scores.find(s=>String(s.name).toLowerCase()===String(h).toLowerCase());
      const sa = scoreObj.scores.find(s=>String(s.name).toLowerCase()===String(a).toLowerCase());
      if (sh && sa) { hs = Number(sh.score||0); as = Number(sa.score||0); }
      else { hs = Number(scoreObj.scores[0].score||0); as = Number(scoreObj.scores[1].score||0); }
    } else {
      hs = Number(scoreObj.home_score || 0);
      as = Number(scoreObj.away_score || 0);
    }
    return { h, a, hs, as };
  }

  function outcomeForSingle(b){ // returns 'win'|'loss'|'push'|null (null=not final)
    const scoreObj = scoreMap[b.meta && b.meta.eventId];
    if (!(scoreObj && scoreObj.completed)) return null;
    const { h, a, hs, as } = getScores(scoreObj);
    const type = (b.meta && b.meta.type) || 'ml';

    if (type==='ml'){
      if (hs===as) return 'push'; // tie
      const name = (b.selection||'').toLowerCase();
      const homePick = h.toLowerCase().includes(name);
      const awayPick = a.toLowerCase().includes(name);
      if (homePick) return hs>as ? 'win' : 'loss';
      if (awayPick) return as>hs ? 'win' : 'loss';
      return 'loss';
    }
    if (type==='spread'){
      const m = String(b.selection).match(/^(.*)\s([+-]?[0-9.]+)$/);
      if (!m) return 'loss';
      const team = m[1].trim(), line = Number(m[2]);
      const isHome = h.toLowerCase().includes(team.toLowerCase());
      const isAway = a.toLowerCase().includes(team.toLowerCase());
      const margin = (isHome ? (hs + line) - as : (isAway ? (as + line) - hs : -Infinity));
      if (!isFinite(margin)) return 'loss';
      if (Math.abs(margin) < 1e-9) return 'push';
      return margin > 0 ? 'win' : 'loss';
    }
    if (type==='total'){
      const m = String(b.selection).match(/^(Over|Under)\s([0-9.]+)$/i);
      if (!m) return 'loss';
      const line = Number(m[2]);
      const sum = hs + as;
      if (Math.abs(sum - line) < 1e-9) return 'push';
      return /over/i.test(m[1]) ? (sum>line ? 'win' : 'loss') : (sum<line ? 'win' : 'loss');
    }
    return 'loss';
  }

  for (let i=0;i<openBets.length;i++){
    const b = openBets[i];

    if (b.type === 'single') {
      const res = outcomeForSingle(b);
      if (res===null) continue;
      if (res==='push') {
        b.status = 'push';
        user.balance += b.stake; // refund
        pushes++; settled++;
      } else {
        b.status = (res==='win') ? 'won' : 'lost';
        if (res==='win') {
          const payout = b.odds>0 ? Math.round(b.stake * (b.odds/100)) : Math.round(b.stake * (100/Math.abs(b.odds)));
          user.balance += b.stake + payout;
          wins++; settled++;
        } else {
          losses++; settled++;
        }
      }
    }

    if (b.type === 'parlay') {
      let allFinal = true, hasWinEligible = false;
      let dec = 1; // combined decimal across non-push legs
      let anyLoss = false;
      let allPush = true;

      for (let j=0;j<(b.legs||[]).length;j++){
        const lg = b.legs[j];
        const fake = { selection: lg.selection, odds: Number(lg.odds), stake: b.stake, meta: lg.meta };
        const res = outcomeForSingle(fake);
        if (res===null) { allFinal = false; break; }
        if (res==='push') {
          // ignore leg (multiply by 1)
        } else {
          allPush = false;
          hasWinEligible = true;
          if (res==='loss') anyLoss = true;
          if (res==='win') dec *= toDecimal(Number(lg.odds));
        }
      }

      if (!allFinal) continue;

      if (allPush) {
        b.status = 'push';
        user.balance += b.stake; // refund entire parlay
        pushes++; settled++;
      } else if (anyLoss) {
        b.status = 'lost';
        losses++; settled++;
      } else {
        b.status = 'won';
        const profit = Math.round(b.stake * (dec - 1));
        user.balance += b.stake + profit;
        wins++; settled++;
      }
    }
  }

  writeUsers(db);
  req.session.user.balance = user.balance;
  res.json({ ok:true, settled, wins, losses, pushes, balance:user.balance });
});

// -------- Odds & scores passthrough ----------
app.get('/api/odds', async (req, res) => {
  try {
    if (!ODDS_API_KEY) return res.status(500).json({ error:'Missing ODDS_API_KEY in .env' });
    const sport = (req.query && req.query.sport) || DEFAULT_SPORT;
    const url = new URL(`https://api.the-odds-api.com/v4/sports/${sport}/odds`);
    url.searchParams.set('regions', DEFAULT_REGION);
    url.searchParams.set('oddsFormat', ODDS_FORMAT);
    url.searchParams.set('markets', 'h2h,spreads,totals');
    url.searchParams.set('apiKey', ODDS_API_KEY);
    const r = await fetch(url);
    if (!r.ok) return res.status(r.status).json({ error:'Upstream error', details: await r.text() });
    const data = await r.json();
    for (let i=0;i<data.length;i++){
      const ev = data[i];
      if (Array.isArray(ev.bookmakers)) {
        ev.bookmakers = ev.bookmakers.filter(b=> b && BOOKMAKER_ALLOWLIST[(b.key||'')] );
      }
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : 'Unknown error' });
  }
});

app.get('/api/scores', async (req, res) => {
  try {
    if (!ODDS_API_KEY) return res.status(500).json({ error:'Missing ODDS_API_KEY in .env' });
    const sport = (req.query && req.query.sport) || DEFAULT_SPORT;
    const daysFrom = (req.query && req.query.daysFrom) || 3;
    const url = new URL(`https://api.the-odds-api.com/v4/sports/${sport}/scores`);
    url.searchParams.set('daysFrom', String(daysFrom));
    url.searchParams.set('apiKey', ODDS_API_KEY);
    const r = await fetch(url);
    if (!r.ok) return res.status(r.status).json({ error:'Upstream error', details: await r.text() });
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : 'Unknown error' });
  }
});

// Gate /
app.get('/', (req, res, next) => {
  if(!(req.session && req.session.user)) return res.redirect('/login.html');
  next();
}, (req, res) => {
  res.sendFile(path.join(__dirnameSafe, 'public', 'index.html'));
});

// Admin page
app.get('/admin', requireAuth, (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).send('Admin only');
  res.sendFile(path.join(__dirnameSafe, 'public', 'admin.html'));
});

app.listen(PORT, () => console.log(`Friends Sportsbook running on http://localhost:${PORT}`));
