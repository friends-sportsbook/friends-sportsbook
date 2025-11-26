const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// fetch compatibility (Node 18+ has global fetch)
const fetch = globalThis.fetch || ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const ODDS_API_KEY = process.env.ODDS_API_KEY || '';
const DEFAULT_SPORT = 'americanfootball_nfl';
const DEFAULT_REGION = 'us';
const ODDS_FORMAT = 'american';
const BOOKMAKER_ALLOWLIST = { draftkings:1, fanduel:1, betmgm:1, caesars:1, pointsbetus:1 };

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieSession({ name:'session', keys:[process.env.SESSION_KEY || 'dev_secret_change_me'], maxAge:24*60*60*1000 }));

// ---------- MongoDB ----------
const { MongoClient } = require('mongodb');
const MONGODB_URI = process.env.MONGODB_URI || '';
if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI in environment.');
}
const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
let db, Users, Bets;

async function initDB(){
  await client.connect();
  // use db name "sportsbook" (logical DB name in the URI is optional)
  db = client.db('sportsbook');
  Users = db.collection('users');
  Bets  = db.collection('bets');
  // indexes
  await Users.createIndex({ username: 1 }, { unique: true });
  await Bets.createIndex({ username: 1, status: 1 });
  // bootstrap admin
  let admin = await Users.findOne({ username: 'admin' });
  if (!admin) {
    const pw = process.env.ADMIN_INIT_PASSWORD || null;
    const hash = pw ? await bcrypt.hash(pw, 10) : null;
    await Users.insertOne({ username:'admin', passwordHash: hash, role:'admin', balance:10000, banned:false, createdAt: new Date() });
    console.log('Admin user created', hash ? '(password set from ADMIN_INIT_PASSWORD)' : '(no password set)');
  } else if (!admin.passwordHash && process.env.ADMIN_INIT_PASSWORD) {
    const hash = await bcrypt.hash(process.env.ADMIN_INIT_PASSWORD, 10);
    await Users.updateOne({ _id: admin._id }, { $set: { passwordHash: hash } });
    console.log('Admin password initialized from ADMIN_INIT_PASSWORD');
  }
}
function requireAuth(req,res,next){ if(!(req.session && req.session.user)) return res.redirect('/login.html'); next(); }
function requireAdmin(req,res,next){
  if(!(req.session && req.session.user)) return res.status(401).json({ error:'Not logged in' });
  if(req.session.user.role !== 'admin') return res.status(403).json({ error:'Admin only' });
  next();
}
function toDecimal(american){ const o = Number(american); if(!isFinite(o)) return 0; return o>0 ? 1 + o/100 : 1 + 100/Math.abs(o); }
function decimalToAmerican(dec){ if(dec<=1) return 0; return dec>=2 ? Math.round((dec-1)*100) : -Math.round(100/(dec-1)); }

// ---------- Static ----------
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Auth ----------
app.get('/api/me', async (req,res)=>{
  if(!(req.session && req.session.user)) return res.json({ user:null });
  const u = await Users.findOne({ username: req.session.user.username }, { projection: { _id:0, username:1, role:1, balance:1, banned:1 }});
  res.json({ user: u || null });
});

// disable public signup
app.post('/api/signup', (req,res)=> res.status(403).json({ error:'Signup disabled. Ask admin to create an account.' }));

// login
app.post('/api/login', async (req,res)=>{
  const username = (req.body && req.body.username || '').trim();
  const password = (req.body && req.body.password || '');
  const user = await Users.findOne({ username: new RegExp('^'+username+'$', 'i') });
  if (!user || !user.passwordHash) return res.status(400).json({ error:'Invalid credentials' });
  if (user.banned) return res.status(403).json({ error:'Account is banned' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(400).json({ error:'Invalid credentials' });
  req.session.user = { username: user.username, role: user.role, balance: user.balance, banned: !!user.banned };
  res.json({ ok:true });
});
app.post('/api/logout', (req,res)=>{ req.session=null; res.json({ ok:true }); });

// ---------- Admin ----------
app.post('/api/admin/create-user', requireAdmin, async (req,res)=>{
  const username = (req.body && req.body.username || '').trim();
  const password = (req.body && req.body.password || '');
  const balance = Math.max(0, Math.floor(Number(req.body && req.body.balance || 0)));
  if (!username || !password) return res.status(400).json({ error:'username and password required' });
  if (username.toLowerCase() === 'admin') return res.status(400).json({ error:'Reserved username' });
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    await Users.insertOne({ username, passwordHash, role:'user', balance, banned:false, createdAt: new Date() });
    res.json({ ok:true });
  } catch (e) {
    if (String(e).includes('duplicate key')) return res.status(400).json({ error:'Username already exists' });
    res.status(500).json({ error:'DB error' });
  }
});
app.get('/api/admin/list-users', requireAdmin, async (req,res)=>{
  const arr = await Users.aggregate([
    { $lookup: { from:'bets', localField:'username', foreignField:'username', as:'_bets' } },
    { $project: { _id:0, username:1, role:1, balance:1, banned:1,
      open: { $size: { $filter: { input:'$_bets', as:'b', cond: { $eq: ['$$b.status', 'open'] } } } }
    } },
    { $sort: { balance: -1 } }
  ]).toArray();
  res.json({ users: arr });
});
app.post('/api/admin/set-balance', requireAdmin, async (req,res)=>{
  const username = (req.body && req.body.username || '').trim();
  const balance = Number(req.body && req.body.balance);
  if (!isFinite(balance)) return res.status(400).json({ error:'Invalid balance' });
  const r = await Users.findOneAndUpdate({ username: new RegExp('^'+username+'$', 'i') }, { $set: { balance: Math.round(balance) } }, { returnDocument:'after' });
  if (!r.value) return res.status(404).json({ error:'User not found' });
  if (req.session.user.username.toLowerCase()===r.value.username.toLowerCase()) req.session.user.balance = r.value.balance;
  res.json({ ok:true, username: r.value.username, balance: r.value.balance });
});
app.post('/api/admin/reset-password', requireAdmin, async (req,res)=>{
  const username = (req.body && req.body.username || '').trim();
  const password = (req.body && req.body.password || '');
  if (!username || !password) return res.status(400).json({ error:'username and password required' });
  const hash = await bcrypt.hash(password, 10);
  const r = await Users.updateOne({ username: new RegExp('^'+username+'$', 'i') }, { $set: { passwordHash: hash } });
  if (!r.matchedCount) return res.status(404).json({ error:'User not found' });
  res.json({ ok:true });
});
app.post('/api/admin/ban', requireAdmin, async (req,res)=>{
  const username = (req.body && req.body.username || '').trim();
  const banned = !!(req.body && req.body.banned);
  const r = await Users.updateOne({ username: new RegExp('^'+username+'$', 'i') }, { $set: { banned } });
  if (!r.matchedCount) return res.status(404).json({ error:'User not found' });
  res.json({ ok:true, username, banned });
});

// ---------- Bets / Odds ----------
app.get('/api/leaderboard', async (req,res)=>{
  const rows = await Users.aggregate([
    { $lookup: { from:'bets', localField:'username', foreignField:'username', as:'_bets' } },
    { $project: { _id:0, username:1, balance:1,
      open: { $size: { $filter: { input:'$_bets', as:'b', cond: { $eq: ['$$b.status', 'open'] } } } }
    } },
    { $sort: { balance: -1 } }
  ]).toArray();
  res.json({ rows });
});
app.get('/api/my-bets', requireAuth, async (req,res)=>{
  const bets = await Bets.find({ username: req.session.user.username }).sort({ createdAt:-1 }).limit(200).toArray();
  res.json({ bets });
});

app.post('/api/bet', requireAuth, async (req,res)=>{
  const u = await Users.findOne({ username: req.session.user.username });
  if (!u) return res.status(401).json({ error:'User missing' });
  if (u.banned) return res.status(403).json({ error:'Account is banned' });

  const parlay = !!(req.body && req.body.parlay);
  const rr = req.body && req.body.rr; // { size, legs }
  const legs = (req.body && req.body.legs) || null;
  const selection = (req.body && req.body.selection) || null;
  const odds = Number(req.body && req.body.odds);
  const stake = Math.max(1, Math.floor(Number(req.body && req.body.stake)));
  const meta = (req.body && req.body.meta) || {};

  if (!isFinite(stake)) return res.status(400).json({ error:'Bad stake' });

  // Round robin => multiple parlays
  if (rr && Array.isArray(rr.legs) && Number(rr.size)>=2) {
    const L = rr.legs, k = Math.floor(Number(rr.size));
    if (L.length < k) return res.status(400).json({ error:'Not enough legs for round robin' });

    function combos(arr,k,start=0,cur=[],out=[]){ if(cur.length===k){ out.push(cur.slice()); return out; } for(let i=start;i<arr.length;i++) combos(arr,k,i+1,cur.concat(arr[i]),out); return out; }
    const sets = combos(L,k);
    const totalStake = sets.length * stake;
    if (u.balance < totalStake) return res.status(400).json({ error:`Insufficient balance (need $${totalStake})` });

    await Users.updateOne({ _id:u._id }, { $inc: { balance: -totalStake } });
    const docs = sets.map(legsSet=>{
      let dec=1; for(const lg of legsSet) dec*=toDecimal(Number(lg.odds));
      const combined = decimalToAmerican(dec);
      return { id: uuidv4(), username:u.username, type:'parlay', combinedOdds: combined, stake, status:'open', legs: legsSet, createdAt: new Date(), meta:{ rr:true, size:k } };
    });
    await Bets.insertMany(docs);
    const nu = await Users.findOne({ _id:u._id });
    req.session.user.balance = nu.balance;
    return res.json({ ok:true, balance: nu.balance, placed: sets.length });
  }

  // Parlay
  if (parlay) {
    if (!Array.isArray(legs) || legs.length < 2) return res.status(400).json({ error:'Parlay needs 2+ legs' });
    if (u.balance < stake) return res.status(400).json({ error:'Insufficient balance' });
    let dec = 1; for(const lg of legs){ if(!lg || !lg.selection || !isFinite(Number(lg.odds))) return res.status(400).json({ error:'Bad leg' }); dec*=toDecimal(Number(lg.odds)); }
    const combined = decimalToAmerican(dec);
    await Users.updateOne({ _id:u._id }, { $inc: { balance: -stake } });
    await Bets.insertOne({ id: uuidv4(), username:u.username, type:'parlay', combinedOdds: combined, stake, status:'open', legs, createdAt: new Date() });
    const nu = await Users.findOne({ _id:u._id });
    req.session.user.balance = nu.balance;
    return res.json({ ok:true, balance: nu.balance });
  }

  // Single
  if (!selection || !isFinite(odds)) return res.status(400).json({ error:'Invalid bet' });
  if (u.balance < stake) return res.status(400).json({ error:'Insufficient balance' });
  await Users.updateOne({ _id:u._id }, { $inc: { balance: -stake } });
  await Bets.insertOne({ id: uuidv4(), username:u.username, type:'single', selection, odds, stake, status:'open', createdAt: new Date(), meta });
  const nu = await Users.findOne({ _id:u._id });
  req.session.user.balance = nu.balance;
  res.json({ ok:true, balance: nu.balance });
});

// ---------- Auto-settle (with push handling) ----------
app.post('/api/settle-open', requireAuth, async (req,res)=>{
  if (!ODDS_API_KEY) return res.status(500).json({ error:'Missing ODDS_API_KEY in .env' });
  const user = req.session.user.username;
  const openBets = await Bets.find({ username:user, status:'open' }).toArray();

  const bySport = {};
  function addMap(sport,id){ if(!sport || !id) return; if(!bySport[sport]) bySport[sport] = {}; bySport[sport][id]=1; }
  for(const b of openBets){
    if (b.type==='single') addMap((b.meta && b.meta.sport) || DEFAULT_SPORT, b.meta && b.meta.eventId);
    if (b.type==='parlay' && Array.isArray(b.legs)) for(const lg of b.legs) addMap((lg.meta && lg.meta.sport) || DEFAULT_SPORT, lg.meta && lg.meta.eventId);
  }

  const scoreMap = {};
  for(const sport of Object.keys(bySport)){
    try{
      const url = new URL(`https://api.the-odds-api.com/v4/sports/${sport}/scores`);
      url.searchParams.set('daysFrom', '3'); url.searchParams.set('apiKey', ODDS_API_KEY);
      const r = await fetch(url); if(!r.ok) continue;
      const arr = await r.json(); for(const s of arr) scoreMap[s.id] = s;
    }catch{}
  }
  function getScores(scoreObj){
    const h = scoreObj.home_team, a = scoreObj.away_team;
    let hs=0, as=0;
    if (Array.isArray(scoreObj.scores) && scoreObj.scores.length>=2){
      const sh = scoreObj.scores.find(s=>String(s.name).toLowerCase()===String(h).toLowerCase());
      const sa = scoreObj.scores.find(s=>String(s.name).toLowerCase()===String(a).toLowerCase());
      if (sh && sa) { hs=Number(sh.score||0); as=Number(sa.score||0); }
      else { hs=Number(scoreObj.scores[0].score||0); as=Number(scoreObj.scores[1].score||0); }
    } else { hs=Number(scoreObj.home_score||0); as=Number(scoreObj.away_score||0); }
    return { h,a,hs,as };
  }
  function outcomeForSingle(b){
    const scoreObj = scoreMap[b.meta && b.meta.eventId];
    if (!(scoreObj && scoreObj.completed)) return null;
    const { h,a,hs,as } = getScores(scoreObj);
    const type = (b.meta && b.meta.type) || 'ml';
    if (type==='ml'){
      if (hs===as) return 'push';
      const name = (b.selection||'').toLowerCase();
      const homePick = h.toLowerCase().includes(name);
      const awayPick = a.toLowerCase().includes(name);
      if (homePick) return hs>as ? 'win':'loss';
      if (awayPick) return as>hs ? 'win':'loss';
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
      return /over/i.test(m[1]) ? (sum>line ? 'win':'loss') : (sum<line ? 'win':'loss');
    }
    return 'loss';
  }

  let settled=0,wins=0,losses=0,pushes=0;
  for(const b of openBets){
    if (b.type==='single'){
      const resu = outcomeForSingle(b);
      if (resu===null) continue;
      if (resu==='push'){
        await Bets.updateOne({ _id:b._id }, { $set: { status:'push' } });
        await Users.updateOne({ username:user }, { $inc: { balance: b.stake } }); // refund
        pushes++; settled++;
      } else if (resu==='win'){
        const profit = b.odds>0 ? Math.round(b.stake*(b.odds/100)) : Math.round(b.stake*(100/Math.abs(b.odds)));
        await Bets.updateOne({ _id:b._id }, { $set: { status:'won' } });
        await Users.updateOne({ username:user }, { $inc: { balance: b.stake + profit } });
        wins++; settled++;
      } else {
        await Bets.updateOne({ _id:b._id }, { $set: { status:'lost' } });
        losses++; settled++;
      }
    } else if (b.type==='parlay'){
      let allFinal=true, anyLoss=false, allPush=true, dec=1;
      for(const lg of (b.legs||[])){
        const fake = { selection: lg.selection, odds: Number(lg.odds), stake: b.stake, meta: lg.meta };
        const r = outcomeForSingle(fake);
        if (r===null) { allFinal=false; break; }
        if (r==='push'){ /* ignore (mult by 1) */ }
        else { allPush=false; if (r==='loss') anyLoss=true; if (r==='win') dec*=toDecimal(Number(lg.odds)); }
      }
      if (!allFinal) continue;
      if (allPush){
        await Bets.updateOne({ _id:b._id }, { $set: { status:'push' } });
        await Users.updateOne({ username:user }, { $inc: { balance: b.stake } });
        pushes++; settled++;
      } else if (anyLoss){
        await Bets.updateOne({ _id:b._id }, { $set: { status:'lost' } });
        losses++; settled++;
      } else {
        const profit = Math.round(b.stake * (dec - 1));
        await Bets.updateOne({ _id:b._id }, { $set: { status:'won' } });
        await Users.updateOne({ username:user }, { $inc: { balance: b.stake + profit } });
        wins++; settled++;
      }
    }
  }
  const nu = await Users.findOne({ username:user });
  req.session.user.balance = nu ? nu.balance : req.session.user.balance;
  res.json({ ok:true, settled, wins, losses, pushes, balance: req.session.user.balance });
});

// ---------- Odds & Scores passthrough ----------
app.get('/api/odds', async (req,res)=>{
  try{
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
    for (const ev of data) if (Array.isArray(ev.bookmakers)) ev.bookmakers = ev.bookmakers.filter(b => b && BOOKMAKER_ALLOWLIST[(b.key||'')]);
    res.json(data);
  } catch (err){ res.status(500).json({ error: err?.message || 'Unknown error' }); }
});
app.get('/api/scores', async (req,res)=>{
  try{
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
  } catch (err){ res.status(500).json({ error: err?.message || 'Unknown error' }); }
});

// ---------- Page gates ----------
app.get('/', (req,res,next)=>{ if(!(req.session && req.session.user)) return res.redirect('/login.html'); next(); }, (req,res)=>{
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/admin', requireAuth, (req,res)=>{
  if (req.session.user.role !== 'admin') return res.status(403).send('Admin only');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ---------- Start ----------
initDB().then(()=>{
  app.listen(PORT, ()=> console.log(`Friends Sportsbook running on http://localhost:${PORT}`));
}).catch(err=>{
  console.error('Failed to init DB:', err?.message || err);
  process.exit(1);
});
