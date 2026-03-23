// test/server.test.js
// White-box tests for server.js
//
// Strategy: every test input is chosen by reading the actual conditions in the
// source and picking values that exercise each branch — especially the boundary
// of each comparison operator.

// Use an in-memory SQLite so tests never touch tinder.sqlite.
process.env.DB_PATH = ":memory:";

const request = require("supertest");
const { app, db } = require("../server");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clearDB() {
  db.prepare("DELETE FROM decisions").run();
  db.prepare("DELETE FROM matches").run();
}

function insertUnseen(profileId, profileObj) {
  db.prepare(
    "INSERT INTO matches (profileId, profile, source, seen, timestamp) VALUES (?, ?, 'like', 0, ?)"
  ).run(profileId, profileObj ? JSON.stringify(profileObj) : null, Date.now());
}

// Reset between every test so each one starts with an empty database.
beforeEach(clearDB);
afterAll(() => db.close());

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/health
// Source: res.json({ status: "ok", timestamp: new Date().toISOString() })
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/health", () => {
  test("returns status=ok and an ISO timestamp", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    // timestamp should be a valid ISO-8601 string
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/decision — input validation
//
// Source line 97:  if (!profileId || typeof profileId !== "string")
// Source line 101: if (!valid.includes(decision))
//
// We choose inputs that flip each sub-expression independently.
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/decision — profileId validation (line 97)", () => {
  // !profileId branch: undefined, null, empty string are all falsy
  test("400 when profileId is absent from body", async () => {
    const res = await request(app)
      .post("/api/decision")
      .send({ decision: "like" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/profileId/);
  });

  test("400 when profileId is empty string (falsy → !profileId is true)", async () => {
    // Boundary: "" is the edge between an empty and a non-empty string.
    const res = await request(app)
      .post("/api/decision")
      .send({ profileId: "", decision: "like" });
    expect(res.status).toBe(400);
  });

  // typeof profileId !== "string" branch
  test("400 when profileId is a number (truthy but wrong type)", async () => {
    // 42 is truthy so !profileId is false, but typeof 42 !== "string" is true.
    const res = await request(app)
      .post("/api/decision")
      .send({ profileId: 42, decision: "like" });
    expect(res.status).toBe(400);
  });

  test("200 when profileId is a non-empty string (both checks pass)", async () => {
    const res = await request(app)
      .post("/api/decision")
      .send({ profileId: "p1", decision: "nope" });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/decision — decision validation (line 101)", () => {
  // !valid.includes(decision): test each valid value and several invalid ones
  test.each(["like", "nope", "superlike"])(
    '200 for valid decision "%s"',
    async (decision) => {
      const res = await request(app)
        .post("/api/decision")
        .send({ profileId: "p1", decision });
      expect(res.status).toBe(200);
    }
  );

  test("400 when decision is a near-miss string", async () => {
    const res = await request(app)
      .post("/api/decision")
      .send({ profileId: "p1", decision: "Love" }); // capitalised — not in valid[]
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/decision must be one of/);
  });

  test("400 when decision is missing from body", async () => {
    const res = await request(app)
      .post("/api/decision")
      .send({ profileId: "p1" });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/decision — match probability
//
// Source line 107: if (decision === "like")      matched = Math.random() < 0.7
// Source line 108: if (decision === "superlike") matched = true
//
// We spy on Math.random to pin the value and test the exact boundary of < 0.7.
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/decision — match probability", () => {
  afterEach(() => jest.restoreAllMocks());

  // ── "like" branch ──────────────────────────────────────────────────────────

  test('"like": random=0.0  → matched=true  (0.0 < 0.7)', async () => {
    jest.spyOn(Math, "random").mockReturnValue(0.0);
    const res = await request(app)
      .post("/api/decision")
      .send({ profileId: "p1", decision: "like" });
    expect(res.body.matched).toBe(true);
  });

  test('"like": random=0.699 → matched=true  (0.699 < 0.7)', async () => {
    jest.spyOn(Math, "random").mockReturnValue(0.699);
    const res = await request(app)
      .post("/api/decision")
      .send({ profileId: "p1", decision: "like" });
    expect(res.body.matched).toBe(true);
  });

  test('"like": random=0.7   → matched=false (0.7 is NOT < 0.7 — boundary!)', async () => {
    // The condition is strict less-than, so exactly 0.7 is the first failing value.
    jest.spyOn(Math, "random").mockReturnValue(0.7);
    const res = await request(app)
      .post("/api/decision")
      .send({ profileId: "p1", decision: "like" });
    expect(res.body.matched).toBe(false);
  });

  test('"like": random=0.701 → matched=false (0.701 > 0.7)', async () => {
    jest.spyOn(Math, "random").mockReturnValue(0.701);
    const res = await request(app)
      .post("/api/decision")
      .send({ profileId: "p1", decision: "like" });
    expect(res.body.matched).toBe(false);
  });

  // ── "superlike" branch ─────────────────────────────────────────────────────

  test('"superlike": always matched=true regardless of Math.random', async () => {
    // Even if random would return a value that would fail the "like" check,
    // superlike bypasses the RNG entirely (matched = true unconditionally).
    jest.spyOn(Math, "random").mockReturnValue(0.999);
    const res = await request(app)
      .post("/api/decision")
      .send({ profileId: "p1", decision: "superlike" });
    expect(res.body.matched).toBe(true);
  });

  // ── "nope" branch: neither condition fires ─────────────────────────────────

  test('"nope": always matched=false regardless of Math.random', async () => {
    // Neither the "like" branch nor the "superlike" branch runs for "nope",
    // so matched stays false even if random would have produced a match.
    jest.spyOn(Math, "random").mockReturnValue(0.0);
    const res = await request(app)
      .post("/api/decision")
      .send({ profileId: "p1", decision: "nope" });
    expect(res.body.matched).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/decision — match row insertion
//
// Source line 113: if (matched) { stmtInsertMatch.run(...) }
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/decision — match row insertion (line 113)", () => {
  afterEach(() => jest.restoreAllMocks());

  test("inserts a match row when matched=true", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0.0); // 0.0 < 0.7 → like matches
    await request(app)
      .post("/api/decision")
      .send({ profileId: "p1", decision: "like" });
    const count = db.prepare("SELECT COUNT(*) as c FROM matches").get().c;
    expect(count).toBe(1);
  });

  test("does NOT insert a match row when matched=false", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0.9); // 0.9 >= 0.7 → no match
    await request(app)
      .post("/api/decision")
      .send({ profileId: "p1", decision: "like" });
    const count = db.prepare("SELECT COUNT(*) as c FROM matches").get().c;
    expect(count).toBe(0);
  });

  test("response stats reflect the inserted decision", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0.9);
    const res = await request(app)
      .post("/api/decision")
      .send({ profileId: "p1", decision: "nope" });
    expect(res.body.stats.rejected).toBe(1);
    expect(res.body.stats.total).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/matches/poll
//
// Source line 123: const rows = stmtUnseenMatches.all()   (seen = 0)
// Source line 124: stmtMarkSeen.run()                      (seen = 1)
// Source line 125: r.profile ? JSON.parse(r.profile) : null
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/matches/poll", () => {
  test("returns empty array and count=0 when no unseen matches", async () => {
    const res = await request(app).get("/api/matches/poll");
    expect(res.status).toBe(200);
    expect(res.body.matches).toEqual([]);
    expect(res.body.count).toBe(0);
  });

  test("returns all unseen matches in one call", async () => {
    insertUnseen("p1", { name: "Alice" });
    insertUnseen("p2", { name: "Bob" });

    const res = await request(app).get("/api/matches/poll");
    expect(res.body.count).toBe(2);
    expect(res.body.matches).toHaveLength(2);
  });

  test("second poll returns empty — first poll marks all as seen (line 124)", async () => {
    insertUnseen("p1", { name: "Alice" });

    await request(app).get("/api/matches/poll"); // marks seen
    const res = await request(app).get("/api/matches/poll"); // should be empty
    expect(res.body.count).toBe(0);
    expect(res.body.matches).toEqual([]);
  });

  test("profile JSON is parsed into an object (truthy branch of line 125)", async () => {
    insertUnseen("p1", { name: "Alice", age: 28 });

    const res = await request(app).get("/api/matches/poll");
    const match = res.body.matches[0];
    expect(match.profile).toEqual({ name: "Alice", age: 28 });
  });

  test("null profile stays null (falsy branch of line 125)", async () => {
    // Insert a match with no profile JSON (null)
    insertUnseen("p2", null);

    const res = await request(app).get("/api/matches/poll");
    const match = res.body.matches[0];
    expect(match.profile).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/decisions/stats
//
// Source: getStats() — counts rows by decision type, total = liked+rejected+superLiked
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/decisions/stats", () => {
  afterEach(() => jest.restoreAllMocks());

  test("all counts are 0 with an empty database", async () => {
    const res = await request(app).get("/api/decisions/stats");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ liked: 0, rejected: 0, superLiked: 0, total: 0 });
  });

  test("counts each decision type independently and sums total correctly", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0.9); // prevent match side-effects
    await request(app).post("/api/decision").send({ profileId: "p1", decision: "like" });
    await request(app).post("/api/decision").send({ profileId: "p2", decision: "like" });
    await request(app).post("/api/decision").send({ profileId: "p3", decision: "nope" });
    await request(app).post("/api/decision").send({ profileId: "p4", decision: "superlike" });

    const res = await request(app).get("/api/decisions/stats");
    expect(res.body.liked).toBe(2);
    expect(res.body.rejected).toBe(1);
    expect(res.body.superLiked).toBe(1);
    expect(res.body.total).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/decisions
//
// Source: DELETE FROM decisions + DELETE FROM matches
// ─────────────────────────────────────────────────────────────────────────────
describe("DELETE /api/decisions", () => {
  test("wipes both decisions and matches tables", async () => {
    // Seed data directly so we know exactly what's there
    db.prepare(
      "INSERT INTO decisions (profileId, decision, profile, matched, timestamp) VALUES (?, ?, ?, ?, ?)"
    ).run("p1", "like", null, 0, Date.now());
    db.prepare(
      "INSERT INTO matches (profileId, profile, source, seen, timestamp) VALUES (?, ?, ?, 0, ?)"
    ).run("p1", null, "like", Date.now());

    const res = await request(app).delete("/api/decisions");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const dCount = db.prepare("SELECT COUNT(*) as c FROM decisions").get().c;
    const mCount = db.prepare("SELECT COUNT(*) as c FROM matches").get().c;
    expect(dCount).toBe(0);
    expect(mCount).toBe(0);
  });
});
