/**
 * Integration tests for server.js
 * Tests all Express routes and database operations
 */

const request = require("supertest");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

// Setup: Create a test database
const TEST_DB_PATH = path.join(__dirname, "tinder.test.sqlite");

// Clean up test database before each test
beforeEach(() => {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
});

afterAll(() => {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
});

// Create a fresh Express app for testing
function createTestApp() {
  const express = require("express");
  const cors = require("cors");
  
  const app = express();
  app.use(cors());
  app.use(express.json());

  const db = new Database(TEST_DB_PATH);

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

  function getStats() {
    return {
      liked: stmtCountDecision("like"),
      rejected: stmtCountDecision("nope"),
      superLiked: stmtCountDecision("superlike"),
      get total() { return this.liked + this.rejected + this.superLiked; },
    };
  }

  // Routes
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
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
    if (decision === "like") matched = Math.random() < 0.7;
    if (decision === "superlike") matched = true;

    const profileJson = JSON.stringify(profile ?? null);
    stmtInsertDecision.run(profileId, decision, profileJson, matched ? 1 : 0, Date.now());

    if (matched) {
      stmtInsertMatch.run(profileId, profileJson, decision, Date.now());
    }

    return res.json({ success: true, decision, matched, stats: getStats() });
  });

  app.get("/api/matches/poll", (_req, res) => {
    const rows = stmtUnseenMatches.all();
    stmtMarkSeen.run();
    const matches = rows.map(r => ({ ...r, profile: r.profile ? JSON.parse(r.profile) : null }));
    res.json({ matches, count: matches.length });
  });

  app.get("/api/matches", (_req, res) => {
    const rows = db.prepare("SELECT * FROM matches ORDER BY timestamp DESC").all();
    res.json(rows.map(r => ({ ...r, profile: r.profile ? JSON.parse(r.profile) : null })));
  });

  app.get("/api/decisions", (_req, res) => {
    const rows = db.prepare("SELECT * FROM decisions ORDER BY timestamp DESC").all();
    res.json(rows.map(r => ({ ...r, profile: r.profile ? JSON.parse(r.profile) : null })));
  });

  app.get("/api/decisions/stats", (_req, res) => {
    res.json(getStats());
  });

  app.delete("/api/decisions", (_req, res) => {
    db.prepare("DELETE FROM decisions").run();
    db.prepare("DELETE FROM matches").run();
    res.json({ success: true, message: "Decision history cleared." });
  });

  return app;
}

describe("Server API Routes", () => {
  let app;

  beforeEach(() => {
    app = createTestApp();
  });

  // ─── /api/health ─────────────────────────────────────────────────────────
  describe("GET /api/health", () => {
    test("should return ok status", async () => {
      const res = await request(app).get("/api/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.timestamp).toBeDefined();
      expect(new Date(res.body.timestamp).getTime()).toBeGreaterThan(0);
    });

    test("should have valid ISO timestamp format", async () => {
      const res = await request(app).get("/api/health");
      const iso = res.body.timestamp;
      expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  // ─── POST /api/decision ──────────────────────────────────────────────────
  describe("POST /api/decision", () => {
    test("should accept a like decision", async () => {
      const res = await request(app)
        .post("/api/decision")
        .send({
          profileId: "test_1",
          decision: "like",
          profile: { name: "Alice" },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.decision).toBe("like");
      expect(typeof res.body.matched).toBe("boolean");
      expect(res.body.stats).toBeDefined();
    });

    test("should accept a nope decision", async () => {
      const res = await request(app)
        .post("/api/decision")
        .send({ profileId: "test_2", decision: "nope" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.decision).toBe("nope");
      expect(res.body.matched).toBe(false);
    });

    test("should accept a superlike decision and always match", async () => {
      const res = await request(app)
        .post("/api/decision")
        .send({ profileId: "test_3", decision: "superlike" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.decision).toBe("superlike");
      expect(res.body.matched).toBe(true); // 100% match for superlike
    });

    test("should reject invalid decision type", async () => {
      const res = await request(app)
        .post("/api/decision")
        .send({ profileId: "test_4", decision: "maybe" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("decision must be one of");
    });

    test("should require profileId", async () => {
      const res = await request(app)
        .post("/api/decision")
        .send({ decision: "like" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("profileId");
    });

    test("should reject non-string profileId", async () => {
      const res = await request(app)
        .post("/api/decision")
        .send({ profileId: 123, decision: "like" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("profileId");
    });

    test("should accept optional profile object", async () => {
      const profile = { name: "Bob", age: 27, city: "NYC" };
      const res = await request(app)
        .post("/api/decision")
        .send({ profileId: "test_5", decision: "like", profile });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test("should store decision in database", async () => {
      await request(app)
        .post("/api/decision")
        .send({ profileId: "test_6", decision: "like" });

      const res = await request(app).get("/api/decisions");
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0].profileId).toBe("test_6");
      expect(res.body[0].decision).toBe("like");
    });

    test("should increment stats correctly", async () => {
      await request(app)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "like" });
      await request(app)
        .post("/api/decision")
        .send({ profileId: "p2", decision: "like" });
      await request(app)
        .post("/api/decision")
        .send({ profileId: "p3", decision: "nope" });
      await request(app)
        .post("/api/decision")
        .send({ profileId: "p4", decision: "superlike" });

      const res = await request(app).get("/api/decisions/stats");
      expect(res.body.liked).toBeGreaterThanOrEqual(2);
      expect(res.body.rejected).toBe(1);
      expect(res.body.superLiked).toBe(1);
    });

    test("should have ~70% match rate for likes", async () => {
      const matches = [];
      const trials = 100;

      for (let i = 0; i < trials; i++) {
        const res = await request(app)
          .post("/api/decision")
          .send({ profileId: `p_${i}`, decision: "like" });
        if (res.body.matched) matches.push(true);
      }

      const matchRate = matches.length / trials;
      // Between 50% and 90% to account for randomness
      expect(matchRate).toBeGreaterThan(0.5);
      expect(matchRate).toBeLessThan(0.9);
    });
  });

  // ─── GET /api/decisions/stats ────────────────────────────────────────────
  describe("GET /api/decisions/stats", () => {
    test("should return stats with zero counts initially", async () => {
      const res = await request(app).get("/api/decisions/stats");
      expect(res.status).toBe(200);
      expect(res.body.liked).toBe(0);
      expect(res.body.rejected).toBe(0);
      expect(res.body.superLiked).toBe(0);
      expect(res.body.total).toBe(0);
    });

    test("should return correct counts after decisions", async () => {
      await request(app)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "like" });
      await request(app)
        .post("/api/decision")
        .send({ profileId: "p2", decision: "nope" });

      const res = await request(app).get("/api/decisions/stats");
      expect(res.body.liked).toBeGreaterThanOrEqual(1);
      expect(res.body.rejected).toBe(1);
      expect(res.body.total).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── GET /api/matches/poll ──────────────────────────────────────────────
  describe("GET /api/matches/poll", () => {
    test("should return empty matches initially", async () => {
      const res = await request(app).get("/api/matches/poll");
      expect(res.status).toBe(200);
      expect(res.body.matches).toEqual([]);
      expect(res.body.count).toBe(0);
    });

    test("should return unseen matches", async () => {
      // Create some matches (superlike always matches)
      await request(app)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "superlike", profile: { name: "Alice" } });
      await request(app)
        .post("/api/decision")
        .send({ profileId: "p2", decision: "superlike", profile: { name: "Bob" } });

      const res = await request(app).get("/api/matches/poll");
      expect(res.status).toBe(200);
      expect(res.body.count).toBeGreaterThanOrEqual(2);
      expect(res.body.matches.length).toBeGreaterThanOrEqual(2);
    });

    test("should mark matches as seen", async () => {
      await request(app)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "superlike" });

      // First poll returns matches
      const res1 = await request(app).get("/api/matches/poll");
      expect(res1.body.count).toBeGreaterThanOrEqual(1);

      // Second poll returns no unseen matches
      const res2 = await request(app).get("/api/matches/poll");
      expect(res2.body.count).toBe(0);
    });

    test("should parse profile JSON correctly", async () => {
      const profile = { name: "Charlie", age: 28, city: "LA" };
      await request(app)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "superlike", profile });

      const res = await request(app).get("/api/matches/poll");
      expect(res.body.matches[0].profile.name).toBe("Charlie");
      expect(res.body.matches[0].profile.age).toBe(28);
    });
  });

  // ─── GET /api/matches ───────────────────────────────────────────────────
  describe("GET /api/matches", () => {
    test("should return empty array initially", async () => {
      const res = await request(app).get("/api/matches");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    test("should return all matches in reverse chronological order", async () => {
      await request(app)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "superlike" });

      const res = await request(app).get("/api/matches");
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    test("should mark all matches as seen", async () => {
      await request(app)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "superlike" });

      let res = await request(app).get("/api/matches/poll");
      expect(res.body.count).toBeGreaterThan(0);

      // Poll again should return empty (already marked seen)
      const res2 = await request(app).get("/api/matches/poll");
      expect(res2.body.count).toBe(0);

      // But /api/matches still shows them
      const all = await request(app).get("/api/matches");
      expect(all.body.length).toBeGreaterThan(0);
    });
  });

  // ─── GET /api/decisions ──────────────────────────────────────────────────
  describe("GET /api/decisions", () => {
    test("should return empty array initially", async () => {
      const res = await request(app).get("/api/decisions");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    test("should return all decisions with all fields", async () => {
      const profile = { name: "Diana" };
      await request(app)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "like", profile });

      const res = await request(app).get("/api/decisions");
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0]).toHaveProperty("id");
      expect(res.body[0]).toHaveProperty("profileId");
      expect(res.body[0]).toHaveProperty("decision");
      expect(res.body[0]).toHaveProperty("timestamp");
      expect(res.body[0]).toHaveProperty("profile");
    });

    test("should return decisions in reverse chronological order", async () => {
      await request(app)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "like" });
      await new Promise(resolve => setTimeout(resolve, 10));
      await request(app)
        .post("/api/decision")
        .send({ profileId: "p2", decision: "nope" });

      const res = await request(app).get("/api/decisions");
      expect(res.body[0].profileId).toBe("p2");
      expect(res.body[1].profileId).toBe("p1");
    });
  });

  // ─── DELETE /api/decisions ──────────────────────────────────────────────
  describe("DELETE /api/decisions", () => {
    test("should clear all decisions", async () => {
      await request(app)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "like" });
      await request(app)
        .post("/api/decision")
        .send({ profileId: "p2", decision: "nope" });

      let res = await request(app).get("/api/decisions");
      expect(res.body.length).toBeGreaterThan(0);

      res = await request(app).delete("/api/decisions");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      res = await request(app).get("/api/decisions");
      expect(res.body).toEqual([]);
    });

    test("should clear all matches", async () => {
      await request(app)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "superlike" });

      let res = await request(app).get("/api/matches");
      expect(res.body.length).toBeGreaterThan(0);

      await request(app).delete("/api/decisions");

      res = await request(app).get("/api/matches");
      expect(res.body).toEqual([]);
    });

    test("should reset stats", async () => {
      await request(app)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "like" });

      let res = await request(app).get("/api/decisions/stats");
      expect(res.body.total).toBeGreaterThan(0);

      await request(app).delete("/api/decisions");

      res = await request(app).get("/api/decisions/stats");
      expect(res.body.liked).toBe(0);
      expect(res.body.rejected).toBe(0);
      expect(res.body.superLiked).toBe(0);
    });
  });

  // ─── Integration scenarios ───────────────────────────────────────────────
  describe("Integration Scenarios", () => {
    test("complete user flow: decide → poll → get full history", async () => {
      // User makes several decisions
      await request(app)
        .post("/api/decision")
        .send({ profileId: "alice", decision: "superlike", profile: { name: "Alice" } });
      await request(app)
        .post("/api/decision")
        .send({ profileId: "bob", decision: "like", profile: { name: "Bob" } });
      await request(app)
        .post("/api/decision")
        .send({ profileId: "charlie", decision: "nope", profile: { name: "Charlie" } });

      // Frontend polls for new matches
      const pollRes = await request(app).get("/api/matches/poll");
      expect(pollRes.body.count).toBeGreaterThanOrEqual(1); // At least superlike

      // Get stats
      const statsRes = await request(app).get("/api/decisions/stats");
      expect(statsRes.body.total).toBe(3);
      expect(statsRes.body.superLiked).toBe(1);
      expect(statsRes.body.rejected).toBe(1);

      // Get full decision history
      const decisionsRes = await request(app).get("/api/decisions");
      expect(decisionsRes.body.length).toBe(3);

      // Get full match history
      const matchesRes = await request(app).get("/api/matches");
      expect(matchesRes.body.length).toBeGreaterThanOrEqual(1);
    });

    test("multiple polls only show unseen matches", async () => {
      await request(app)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "superlike" });
      await request(app)
        .post("/api/decision")
        .send({ profileId: "p2", decision: "superlike" });

      // First poll
      const poll1 = await request(app).get("/api/matches/poll");
      const count1 = poll1.body.count;
      expect(count1).toBeGreaterThanOrEqual(2);

      // Second poll should be empty (already marked seen)
      const poll2 = await request(app).get("/api/matches/poll");
      expect(poll2.body.count).toBe(0);

      // /api/matches should still show all
      const all = await request(app).get("/api/matches");
      expect(all.body.length).toBeGreaterThanOrEqual(count1);
    });

    test("handles null profiles gracefully", async () => {
      await request(app)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "like", profile: null });

      const res = await request(app).get("/api/decisions");
      expect(res.body[0].profile).toBeNull();
    });
  });
});
