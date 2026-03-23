/**
 * Edge-case tests for server.js
 *
 * Uses an in-memory SQLite database and a reconstructed Express app
 * that mirrors server.js so tests are fast and fully isolated.
 */

const request  = require("supertest");
const express  = require("express");
const Database = require("better-sqlite3");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildApp(db) {
  const app = express();
  app.use(express.json());

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
  const stmtMarkSeen      = db.prepare("UPDATE matches SET seen = 1 WHERE seen = 0");

  function stmtCountDecision(type) {
    return db.prepare(`SELECT COUNT(*) as c FROM decisions WHERE decision = '${type}'`).get().c;
  }
  function getStats() {
    return {
      liked:      stmtCountDecision("like"),
      rejected:   stmtCountDecision("nope"),
      superLiked: stmtCountDecision("superlike"),
    };
  }

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
    if (decision === "like")      matched = Math.random() < 0.7;
    if (decision === "superlike") matched = true;

    const profileJson = JSON.stringify(profile ?? null);
    stmtInsertDecision.run(profileId, decision, profileJson, matched ? 1 : 0, Date.now());
    if (matched) stmtInsertMatch.run(profileId, profileJson, decision, Date.now());

    return res.json({ success: true, decision, matched, stats: getStats() });
  });

  app.get("/api/matches/poll", (_req, res) => {
    const rows = stmtUnseenMatches.all();
    stmtMarkSeen.run();
    const matches = rows.map(r => ({
      ...r,
      profile: r.profile ? JSON.parse(r.profile) : null,
    }));
    res.json({ matches, count: matches.length });
  });

  app.delete("/api/decisions", (_req, res) => {
    db.prepare("DELETE FROM decisions").run();
    db.prepare("DELETE FROM matches").run();
    res.json({ success: true, message: "Decision history cleared." });
  });

  app.get("/api/decisions/stats", (_req, res) => res.json(getStats()));

  // Expose internals for direct DB manipulation in tests
  app.locals.db             = db;
  app.locals.stmtInsertMatch = stmtInsertMatch;

  return app;
}

function freshApp() {
  return buildApp(new Database(":memory:"));
}

// ─── POST /api/decision ───────────────────────────────────────────────────────

describe("POST /api/decision — input validation edge cases", () => {
  let app;
  beforeEach(() => { app = freshApp(); });

  test("rejects missing profileId", async () => {
    const res = await request(app)
      .post("/api/decision")
      .send({ decision: "like" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/profileId/);
  });

  test("rejects empty-string profileId", async () => {
    const res = await request(app)
      .post("/api/decision")
      .send({ profileId: "", decision: "like" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/profileId/);
  });

  test("rejects numeric profileId (wrong type)", async () => {
    const res = await request(app)
      .post("/api/decision")
      .send({ profileId: 42, decision: "like" });
    expect(res.status).toBe(400);
  });

  test("rejects unknown decision value", async () => {
    const res = await request(app)
      .post("/api/decision")
      .send({ profileId: "p1", decision: "dislike" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/decision must be one of/);
  });

  test("rejects missing decision field", async () => {
    const res = await request(app)
      .post("/api/decision")
      .send({ profileId: "p1" });
    expect(res.status).toBe(400);
  });

  test("accepts null profile payload (optional field)", async () => {
    const res = await request(app)
      .post("/api/decision")
      .send({ profileId: "p1", decision: "nope" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("superlike always returns matched=true", async () => {
    // Run enough iterations that a probabilistic failure would show up
    for (let i = 0; i < 20; i++) {
      const res = await request(app)
        .post("/api/decision")
        .send({ profileId: `p_${i}`, decision: "superlike" });
      expect(res.body.matched).toBe(true);
    }
  });

  test("nope never returns matched=true", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await request(app)
        .post("/api/decision")
        .send({ profileId: `p_${i}`, decision: "nope" });
      expect(res.body.matched).toBe(false);
    }
  });

  test("duplicate profileId can be submitted multiple times without error", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post("/api/decision")
        .send({ profileId: "same_id", decision: "like" });
      expect(res.status).toBe(200);
    }
    // Stats should reflect all three submissions
    const stats = await request(app).get("/api/decisions/stats");
    expect(stats.body.liked).toBe(3);
  });
});

// ─── GET /api/matches/poll — race condition ───────────────────────────────────

describe("GET /api/matches/poll — race condition", () => {
  test("two concurrent poll requests do not both return the same unseen match", async () => {
    const app = freshApp();
    const { stmtInsertMatch } = app.locals;

    // Seed one unseen match
    stmtInsertMatch.run("mock_1", JSON.stringify({ name: "Riley" }), "incoming", Date.now());

    // Fire both requests without awaiting either first
    const [r1, r2] = await Promise.all([
      request(app).get("/api/matches/poll"),
      request(app).get("/api/matches/poll"),
    ]);

    // Combined matches across both responses must equal 1 — the same match
    // must not be returned twice. Requires fetch + mark-seen to be atomic (transaction).
    const combined = [...r1.body.matches, ...r2.body.matches];
    expect(combined.length).toBe(1);
  });

  test("poll returns empty array when no unseen matches exist", async () => {
    const app = freshApp();
    const res = await request(app).get("/api/matches/poll");
    expect(res.status).toBe(200);
    expect(res.body.matches).toEqual([]);
    expect(res.body.count).toBe(0);
  });

  test("second poll after first returns nothing (matches marked seen)", async () => {
    const app = freshApp();
    const { stmtInsertMatch } = app.locals;

    stmtInsertMatch.run("m1", JSON.stringify({ name: "Morgan" }), "incoming", Date.now());

    await request(app).get("/api/matches/poll"); // consume
    const res2 = await request(app).get("/api/matches/poll"); // should be empty
    expect(res2.body.matches).toHaveLength(0);
  });

  test("poll handles row with null/missing profile JSON without crashing", async () => {
    const app = freshApp();
    const { db } = app.locals;

    // Insert a row with a NULL profile directly
    db.prepare(
      "INSERT INTO matches (profileId, profile, source, seen, timestamp) VALUES (?, NULL, 'incoming', 0, ?)"
    ).run("m_null", Date.now());

    const res = await request(app).get("/api/matches/poll");
    expect(res.status).toBe(200);
    const match = res.body.matches[0];
    expect(match.profile).toBeNull();
  });

  test("poll handles row with corrupted profile JSON without crashing", async () => {
    const app = freshApp();
    const { db } = app.locals;

    db.prepare(
      "INSERT INTO matches (profileId, profile, source, seen, timestamp) VALUES (?, ?, 'incoming', 0, ?)"
    ).run("m_bad", "NOT_VALID_JSON{{{", Date.now());

    const res = await request(app).get("/api/matches/poll");
    expect(res.status).toBe(200);
  });

  test("multiple unseen matches all appear in a single poll response", async () => {
    const app = freshApp();
    const { stmtInsertMatch } = app.locals;

    stmtInsertMatch.run("m1", JSON.stringify({ name: "A" }), "incoming", Date.now());
    stmtInsertMatch.run("m2", JSON.stringify({ name: "B" }), "incoming", Date.now() + 1);
    stmtInsertMatch.run("m3", JSON.stringify({ name: "C" }), "incoming", Date.now() + 2);

    const res = await request(app).get("/api/matches/poll");
    expect(res.body.count).toBe(3);
    expect(res.body.matches).toHaveLength(3);
  });
});

// ─── DELETE /api/decisions ────────────────────────────────────────────────────

describe("DELETE /api/decisions", () => {
  test("clears both decisions AND matches tables", async () => {
    const app = freshApp();

    // Create a superlike (always matched, so also inserts into matches)
    await request(app)
      .post("/api/decision")
      .send({ profileId: "p1", decision: "superlike", profile: { name: "X" } });

    const before = await request(app).get("/api/decisions/stats");
    expect(before.body.superLiked).toBe(1);

    await request(app).delete("/api/decisions");

    const after = await request(app).get("/api/decisions/stats");
    expect(after.body.liked).toBe(0);
    expect(after.body.rejected).toBe(0);
    expect(after.body.superLiked).toBe(0);

    // Matches table should also be empty
    const poll = await request(app).get("/api/matches/poll");
    expect(poll.body.matches).toHaveLength(0);
  });

  test("DELETE is idempotent — second call on empty DB still returns success", async () => {
    const app = freshApp();
    const r1 = await request(app).delete("/api/decisions");
    const r2 = await request(app).delete("/api/decisions");
    expect(r1.body.success).toBe(true);
    expect(r2.body.success).toBe(true);
  });
});

// ─── Stats ───────────────────────────────────────────────────────────────────

describe("GET /api/decisions/stats", () => {
  test("all counters start at zero on fresh DB", async () => {
    const app = freshApp();
    const res = await request(app).get("/api/decisions/stats");
    expect(res.body).toEqual({ liked: 0, rejected: 0, superLiked: 0 });
  });

  test("stats reflect mixed decisions correctly", async () => {
    const app = freshApp();
    await request(app).post("/api/decision").send({ profileId: "a", decision: "like" });
    await request(app).post("/api/decision").send({ profileId: "b", decision: "like" });
    await request(app).post("/api/decision").send({ profileId: "c", decision: "nope" });
    await request(app).post("/api/decision").send({ profileId: "d", decision: "superlike" });

    const res = await request(app).get("/api/decisions/stats");
    expect(res.body.liked).toBe(2);
    expect(res.body.rejected).toBe(1);
    expect(res.body.superLiked).toBe(1);
  });
});
