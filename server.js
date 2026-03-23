// server.js
// Express backend for AI Tinder — tracks Like, Nope, Super Like decisions.
// Bonus: real local SQLite database via better-sqlite3.

const express  = require("express");
const cors     = require("cors");
const path     = require("path");
const Database = require("better-sqlite3");

const app = express();
app.use(cors());
app.use(express.json());

// Serve the frontend (index.html, app.js, styles.css, etc.) from the project root
app.use(express.static(path.join(__dirname)));

// ─── SQLite setup (Bonus: real local database) ────────────────────────────────
// DB_PATH env var lets tests inject ":memory:" instead of the real file.
const db = new Database(process.env.DB_PATH || path.join(__dirname, "tinder.sqlite"));

db.exec(`
  CREATE TABLE IF NOT EXISTS decisions (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    profileId TEXT    NOT NULL,
    decision  TEXT    NOT NULL,
    profile   TEXT,
    matched   INTEGER DEFAULT 0,
    timestamp INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS matches (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    profileId TEXT NOT NULL,
    profile   TEXT,
    source    TEXT    DEFAULT 'like',
    seen      INTEGER DEFAULT 0,
    timestamp INTEGER NOT NULL
  );
`);

const stmtInsertDecision   = db.prepare("INSERT INTO decisions (profileId, decision, profile, matched, timestamp) VALUES (?, ?, ?, ?, ?)");
const stmtInsertMatch      = db.prepare("INSERT INTO matches (profileId, profile, source, seen, timestamp) VALUES (?, ?, ?, 0, ?)");
const stmtUnseenMatches    = db.prepare("SELECT * FROM matches WHERE seen = 0 ORDER BY timestamp ASC");
const stmtMarkSeen         = db.prepare("UPDATE matches SET seen = 1 WHERE seen = 0");
const stmtCountDecision    = (type) => db.prepare(`SELECT COUNT(*) as c FROM decisions WHERE decision = '${type}'`).get().c;

// ─── Mock "likes" database ────────────────────────────────────────────────────
// These profiles have already liked you — used to simulate incoming matches
// during the polling interval so testing always produces matches.
const MOCK_LIKES_DB = [
  { profileId: "mock_1", name: "Riley",   age: 26, city: "Brooklyn",     title: "UX Designer" },
  { profileId: "mock_2", name: "Morgan",  age: 29, city: "Manhattan",    title: "Chef" },
  { profileId: "mock_3", name: "Casey",   age: 24, city: "Hoboken",      title: "Photographer" },
  { profileId: "mock_4", name: "Avery",   age: 31, city: "Astoria",      title: "Software Engineer" },
  { profileId: "mock_5", name: "Jordan",  age: 27, city: "Williamsburg", title: "Architect" },
  { profileId: "mock_6", name: "Taylor",  age: 23, city: "Queens",       title: "Nurse" },
  { profileId: "mock_7", name: "Quinn",   age: 28, city: "Harlem",       title: "Data Analyst" },
  { profileId: "mock_8", name: "Emerson", age: 25, city: "Brooklyn",     title: "Teacher" },
];

function sample(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ─── Simulate incoming likes every 20–30 s ────────────────────────────────────
// Queues an unseen match from the mock DB so the frontend poll finds it.
function scheduleIncomingLike() {
  const delay = 20000 + Math.floor(Math.random() * 10000); // 20–30 s
  setTimeout(() => {
    const profile = sample(MOCK_LIKES_DB);
    stmtInsertMatch.run(profile.profileId, JSON.stringify(profile), "incoming", Date.now());
    console.log(`  💌 Incoming like queued from ${profile.name} (${profile.city})`);
    scheduleIncomingLike(); // schedule next one
  }, delay);
}
// ─── Helpers ─────────────────────────────────────────────────────────────────
function getStats() {
  return {
    liked:      stmtCountDecision("like"),
    rejected:   stmtCountDecision("nope"),
    superLiked: stmtCountDecision("superlike"),
    get total() { return this.liked + this.rejected + this.superLiked; },
  };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// POST /api/decision
// Body: { profileId, decision: "like"|"nope"|"superlike", profile? }
// Returns: { success, decision, matched, stats }
app.post("/api/decision", (req, res) => {
  const { profileId, decision, profile } = req.body;

  if (!profileId || typeof profileId !== "string") {
    return res.status(400).json({ error: "profileId (string) is required" });
  }
  const valid = ["like", "nope", "superlike"];
  if (!valid.includes(decision)) {
    return res.status(400).json({ error: `decision must be one of: ${valid.join(", ")}` });
  }

  // 70% match chance on like (high for easy testing), 100% on superlike
  let matched = false;
  if (decision === "like")      matched = Math.random() < 0.7;
  if (decision === "superlike") matched = true;

  const profileJson = JSON.stringify(profile ?? null);
  stmtInsertDecision.run(profileId, decision, profileJson, matched ? 1 : 0, Date.now());

  if (matched) {
    stmtInsertMatch.run(profileId, profileJson, decision, Date.now());
  }

  return res.json({ success: true, decision, matched, stats: getStats() });
});

// GET /api/matches/poll
// Frontend calls this every 10 s — returns unseen matches and marks them read.
app.get("/api/matches/poll", (_req, res) => {
  const rows = stmtUnseenMatches.all();
  stmtMarkSeen.run();
  const matches = rows.map(r => ({ ...r, profile: r.profile ? JSON.parse(r.profile) : null }));
  res.json({ matches, count: matches.length });
});

// GET /api/matches — full match history
app.get("/api/matches", (_req, res) => {
  const rows = db.prepare("SELECT * FROM matches ORDER BY timestamp DESC").all();
  res.json(rows.map(r => ({ ...r, profile: r.profile ? JSON.parse(r.profile) : null })));
});

// GET /api/decisions — full decision history
app.get("/api/decisions", (_req, res) => {
  const rows = db.prepare("SELECT * FROM decisions ORDER BY timestamp DESC").all();
  res.json(rows.map(r => ({ ...r, profile: r.profile ? JSON.parse(r.profile) : null })));
});

// GET /api/decisions/stats
app.get("/api/decisions/stats", (_req, res) => {
  res.json(getStats());
});

// DELETE /api/decisions — wipe everything (for testing)
app.delete("/api/decisions", (_req, res) => {
  db.prepare("DELETE FROM decisions").run();
  db.prepare("DELETE FROM matches").run();
  res.json({ success: true, message: "Decision history cleared." });
});

// ─── Start ───────────────────────────────────────────────────────────────────
// Guard lets tests `require('./server')` without binding a port or running timers.
if (require.main === module) {
  scheduleIncomingLike();
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`\n🔥 AI Tinder backend running at http://localhost:${PORT}`);
    console.log("   Endpoints:");
    console.log("     GET    /api/health");
    console.log("     POST   /api/decision");
    console.log("     GET    /api/matches/poll     ← frontend polls this every 10 s");
    console.log("     GET    /api/matches          ← full match history");
    console.log("     GET    /api/decisions");
    console.log("     GET    /api/decisions/stats");
    console.log("     DELETE /api/decisions");
    console.log("\n   SQLite DB: tinder.sqlite");
    console.log("   Simulating incoming likes every 20–30 s...\n");
  });
}

module.exports = { app, db };
