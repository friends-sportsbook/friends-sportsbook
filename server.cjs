// server.cjs — clean working version

const express = require("express");
const cors = require("cors");
const path = require("path");
const { getDb } = require("./db.cjs");

const app = express();

// ---- Middlewares ----
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---- Static files (serve your website) ----
app.use(express.static(path.join(__dirname, "public")));

// ---- Example root route ----
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---- ADD USER ACCOUNT ROUTES ----
// REGISTER USER
app.post("/register", async (req, res) => {
  try {
    const db = await getDb();
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "email and password required" });
    }

    await db.collection("users").insertOne({
      email,
      password,
      createdAt: new Date(),
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("REGISTER error:", e);
    res.status(500).json({ error: "server error" });
  }
});

// LOGIN USER
app.post("/login", async (req, res) => {
  try {
    const db = await getDb();
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "email and password required" });
    }

    const user = await db.collection("users").findOne({ email, password });
    if (!user) return res.status(401).json({ error: "Invalid login" });

    res.json({ ok: true });
  } catch (e) {
    console.error("LOGIN error:", e);
    res.status(500).json({ error: "server error" });
  }
});

// ---- Start Server ----
// --- Simple Odds API Route ---
const fetch = global.fetch || ((...a) => import('node-fetch').then(({ default: f }) => f(...a)));

app.get("/api/lines", async (req, res) => {
  try {
    const url = process.env.ODDS_API_URL;
    if (!url) {
      return res.status(500).json({ error: "ODDS_API_URL not set" });
    }

    const r = await fetch(url);
    const text = await r.text();

    if (!r.ok) {
      console.error("UPSTREAM ERROR", r.status, text.slice(0, 200));
      return res.status(502).json({ error: "upstream", status: r.status });
    }

    res.type("application/json").send(text);
  } catch (e) {
    console.error("FETCH ERROR", e.message);
    res.status(502).json({ error: "fetch-failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
