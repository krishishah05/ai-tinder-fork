// server.js
// Express backend for AI Tinder — tracks Like, Nope, Super Like decisions.
// Bonus: real local SQLite database via better-sqlite3.

const express = require("express");
const cors = require("cors");
const path = require("path");
const Database = require("better-sqlite3");

const MOCK_LIKES_DB = [
  { profileId: "mock_1", name: "Riley", age: 26, city: "Brooklyn", title: "UX Designer" },
  { profileId: "mock_2", name: "Morgan", age: 29, city: "Manhattan", title: "Chef" },
  { profileId: "mock_3", name: "Casey", age: 24, city: "Hoboken", title: "Photographer" },
  { profileId: "mock_4", name: "Avery", age: 31, city: "Astoria", title: "Software Engineer" },
  { profileId: "mock_5", name: "Jordan", age: 27, city: "Williamsburg", title: "Architect" },
  { profileId: "mock_6", name: "Taylor", age: 23, city: "Queens", title: "Nurse" },
  { profileId: "mock_7", name: "Quinn", age: 28, city: "Harlem", title: "Data Analyst" },
  { profileId: "mock_8", name: "Emerson", age: 25, city: "Brooklyn", title: "Teacher" },
];

function createServer(options = {}) {
  const {
    dbPath = path.join(__dirname, "tinder.sqlite"),
    random = Math.random,
    now = () => Date.now(),
    logger = console,
    scheduleIncomingLikes = true,
  } = options;

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname)));

  const db = new Database(dbPath);

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

  const stmtInsertDecision = db.prepare(
    "INSERT INTO decisions (profileId, decision, profile, matched, timestamp) VALUES (?, ?, ?, ?, ?)"
  );
  const stmtInsertMatch = db.prepare(
    "INSERT INTO matches (profileId, profile, source, seen, timestamp) VALUES (?, ?, ?, 0, ?)"
  );
  const stmtUnseenMatches = db.prepare("SELECT * FROM matches WHERE seen = 0 ORDER BY timestamp ASC");
  const stmtMarkSeen = db.prepare("UPDATE matches SET seen = 1 WHERE seen = 0");
  const stmtCountDecision = (type) =>
    db.prepare(`SELECT COUNT(*) as c FROM decisions WHERE decision = '${type}'`).get().c;

  function sample(arr) {
    return arr[Math.floor(random() * arr.length)];
  }

  let incomingLikeTimer = null;

  function scheduleIncomingLike() {
    const delay = 20000 + Math.floor(random() * 10000);
    incomingLikeTimer = setTimeout(() => {
      const profile = sample(MOCK_LIKES_DB);
      stmtInsertMatch.run(profile.profileId, JSON.stringify(profile), "incoming", now());
      logger.log(`  💌 Incoming like queued from ${profile.name} (${profile.city})`);
      scheduleIncomingLike();
    }, delay);
    return incomingLikeTimer;
  }

  function stopIncomingLikes() {
    if (incomingLikeTimer) {
      clearTimeout(incomingLikeTimer);
      incomingLikeTimer = null;
    }
  }

  if (scheduleIncomingLikes) {
    scheduleIncomingLike();
  }

  function getStats() {
    return {
      liked: stmtCountDecision("like"),
      rejected: stmtCountDecision("nope"),
      superLiked: stmtCountDecision("superlike"),
      get total() {
        return this.liked + this.rejected + this.superLiked;
      },
    };
  }

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date(now()).toISOString() });
  });

  app.post("/api/decision", (req, res) => {
    const { profileId, decision, profile } = req.body;

    if (!profileId || typeof profileId !== "string") {
      return res.status(400).json({ error: "profileId (string) is required" });
    }

    const valid = ["like", "nope", "superlike"];
    if (!valid.includes(decision)) {
      return res.status(400).json({ error: `decision must be one of: ${valid.join(", ")}` });
    }

    let matched = false;
    if (decision === "like") {
      matched = random() < 0.7;
    }
    if (decision === "superlike") {
      matched = true;
    }

    const profileJson = JSON.stringify(profile ?? null);
    stmtInsertDecision.run(profileId, decision, profileJson, matched ? 1 : 0, now());

    if (matched) {
      stmtInsertMatch.run(profileId, profileJson, decision, now());
    }

    return res.json({ success: true, decision, matched, stats: getStats() });
  });

  app.get("/api/matches/poll", (_req, res) => {
    const rows = stmtUnseenMatches.all();
    stmtMarkSeen.run();
    const matches = rows.map((row) => ({
      ...row,
      profile: row.profile ? JSON.parse(row.profile) : null,
    }));

    res.json({ matches, count: matches.length });
  });

  app.get("/api/matches", (_req, res) => {
    const rows = db.prepare("SELECT * FROM matches ORDER BY timestamp DESC, id DESC").all();
    res.json(
      rows.map((row) => ({
        ...row,
        profile: row.profile ? JSON.parse(row.profile) : null,
      }))
    );
  });

  app.get("/api/decisions", (_req, res) => {
    const rows = db.prepare("SELECT * FROM decisions ORDER BY timestamp DESC, id DESC").all();
    res.json(
      rows.map((row) => ({
        ...row,
        profile: row.profile ? JSON.parse(row.profile) : null,
      }))
    );
  });

  app.get("/api/decisions/stats", (_req, res) => {
    res.json(getStats());
  });

  app.delete("/api/decisions", (_req, res) => {
    db.prepare("DELETE FROM decisions").run();
    db.prepare("DELETE FROM matches").run();
    res.json({ success: true, message: "Decision history cleared." });
  });

  return {
    app,
    db,
    getStats,
    scheduleIncomingLike,
    stopIncomingLikes,
    close() {
      stopIncomingLikes();
      db.close();
    },
  };
}

function startServer() {
  const { app } = createServer();
  const PORT = process.env.PORT || 3000;

  return app.listen(PORT, () => {
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

if (require.main === module) {
  startServer();
}

module.exports = {
  MOCK_LIKES_DB,
  createServer,
  startServer,
};
