const request = require("supertest");
const { createServer, MOCK_LIKES_DB } = require("../server");

function createRandomSequence(values, fallback = 0) {
  let index = 0;
  return () => {
    if (index < values.length) {
      const value = values[index];
      index += 1;
      return value;
    }
    return fallback;
  };
}

function createNowSequence(start = 1_700_000_000_000) {
  let current = start;
  return () => {
    const value = current;
    current += 1;
    return value;
  };
}

describe("backend partition tests", () => {
  let server;

  afterEach(() => {
    server?.close();
    server = null;
  });

  it("serves the health endpoint", async () => {
    server = createServer({
      dbPath: ":memory:",
      scheduleIncomingLikes: false,
      now: () => 1_700_000_000_000,
      logger: { log() {} },
    });

    const res = await request(server.app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "ok",
      timestamp: new Date(1_700_000_000_000).toISOString(),
    });
  });

  it.each([
    [{ decision: "like" }, "profileId (string) is required"],
    [{ profileId: null, decision: "like" }, "profileId (string) is required"],
    [{ profileId: "", decision: "like" }, "profileId (string) is required"],
    [{ profileId: 123, decision: "like" }, "profileId (string) is required"],
  ])("rejects invalid profileId payloads: %o", async (payload, expectedError) => {
    server = createServer({
      dbPath: ":memory:",
      scheduleIncomingLikes: false,
      logger: { log() {} },
    });

    const res = await request(server.app).post("/api/decision").send(payload);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expectedError });
  });

  it.each([
    [null],
    ["raw-text"],
    ["42"],
  ])("rejects non-object request bodies: %o", async (payload) => {
    server = createServer({
      dbPath: ":memory:",
      scheduleIncomingLikes: false,
      logger: { log() {} },
    });

    const res = await request(server.app)
      .post("/api/decision")
      .set("Content-Type", "application/json")
      .send(payload);
    const decisions = await request(server.app).get("/api/decisions");

    expect(res.status).toBe(400);
    expect(decisions.body).toEqual([]);
  });

  it.each([
    [{ profileId: "p1" }, "decision must be one of: like, nope, superlike"],
    [{ profileId: "p1", decision: "LIKE" }, "decision must be one of: like, nope, superlike"],
    [{ profileId: "p1", decision: "skip" }, "decision must be one of: like, nope, superlike"],
    [{ profileId: "p1", decision: 9 }, "decision must be one of: like, nope, superlike"],
  ])("rejects invalid decision payloads: %o", async (payload, expectedError) => {
    server = createServer({
      dbPath: ":memory:",
      scheduleIncomingLikes: false,
      logger: { log() {} },
    });

    const res = await request(server.app).post("/api/decision").send(payload);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expectedError });
  });

  it("accepts omitted, null, object, and primitive profile payloads", async () => {
    server = createServer({
      dbPath: ":memory:",
      scheduleIncomingLikes: false,
      now: createNowSequence(),
      logger: { log() {} },
    });

    await request(server.app).post("/api/decision").send({ profileId: "omitted", decision: "nope" });
    await request(server.app).post("/api/decision").send({ profileId: "null", decision: "nope", profile: null });
    await request(server.app).post("/api/decision").send({
      profileId: "object",
      decision: "nope",
      profile: { name: "Alex", city: "Brooklyn" },
    });
    await request(server.app).post("/api/decision").send({
      profileId: "primitive",
      decision: "nope",
      profile: "raw-text",
    });

    const decisions = await request(server.app).get("/api/decisions");
    const byId = Object.fromEntries(decisions.body.map((row) => [row.profileId, row.profile]));

    expect(byId.omitted).toBe(null);
    expect(byId.null).toBe(null);
    expect(byId.object).toEqual({ name: "Alex", city: "Brooklyn" });
    expect(byId.primitive).toBe("raw-text");
  });

  it("covers like matched, like unmatched, nope, and superlike outcome partitions", async () => {
    server = createServer({
      dbPath: ":memory:",
      scheduleIncomingLikes: false,
      now: createNowSequence(),
      random: createRandomSequence([0.6, 0.9]),
      logger: { log() {} },
    });

    const likeMatched = await request(server.app)
      .post("/api/decision")
      .send({ profileId: "like-hit", decision: "like", profile: { name: "Riley" } });
    const likeMissed = await request(server.app)
      .post("/api/decision")
      .send({ profileId: "like-miss", decision: "like", profile: { name: "Morgan" } });
    const nope = await request(server.app)
      .post("/api/decision")
      .send({ profileId: "nope-1", decision: "nope" });
    const superlike = await request(server.app)
      .post("/api/decision")
      .send({ profileId: "super-1", decision: "superlike", profile: { name: "Casey" } });

    expect(likeMatched.body.matched).toBe(true);
    expect(likeMissed.body.matched).toBe(false);
    expect(nope.body.matched).toBe(false);
    expect(superlike.body.matched).toBe(true);

    const stats = await request(server.app).get("/api/decisions/stats");
    expect(stats.body).toEqual({
      liked: 2,
      rejected: 1,
      superLiked: 1,
      total: 4,
    });

    const matches = await request(server.app).get("/api/matches");
    expect(matches.body.map((row) => ({ profileId: row.profileId, source: row.source }))).toEqual([
      { profileId: "super-1", source: "superlike" },
      { profileId: "like-hit", source: "like" },
    ]);
  });

  it("counts duplicate decisions for the same profileId as separate records", async () => {
    server = createServer({
      dbPath: ":memory:",
      scheduleIncomingLikes: false,
      now: createNowSequence(),
      random: () => 0.95,
      logger: { log() {} },
    });

    await request(server.app).post("/api/decision").send({ profileId: "repeat", decision: "like" });
    await request(server.app).post("/api/decision").send({ profileId: "repeat", decision: "nope" });
    await request(server.app).post("/api/decision").send({ profileId: "repeat", decision: "superlike" });

    const stats = await request(server.app).get("/api/decisions/stats");
    const decisions = await request(server.app).get("/api/decisions");

    expect(stats.body).toEqual({
      liked: 1,
      rejected: 1,
      superLiked: 1,
      total: 3,
    });
    expect(decisions.body.map((row) => row.profileId)).toEqual(["repeat", "repeat", "repeat"]);
  });

  it("returns unseen matches once and marks them seen across user and incoming sources", async () => {
    server = createServer({
      dbPath: ":memory:",
      scheduleIncomingLikes: false,
      now: createNowSequence(),
      random: () => 0.2,
      logger: { log() {} },
    });

    await request(server.app)
      .post("/api/decision")
      .send({ profileId: "user-match", decision: "like", profile: { name: "Alex" } });

    server.db
      .prepare("INSERT INTO matches (profileId, profile, source, seen, timestamp) VALUES (?, ?, ?, 0, ?)")
      .run(MOCK_LIKES_DB[0].profileId, JSON.stringify(MOCK_LIKES_DB[0]), "incoming", 1_700_000_000_100);

    const firstPoll = await request(server.app).get("/api/matches/poll");
    const secondPoll = await request(server.app).get("/api/matches/poll");
    const history = await request(server.app).get("/api/matches");

    expect(firstPoll.body.count).toBe(2);
    expect(firstPoll.body.matches.map((row) => row.source)).toEqual(["like", "incoming"]);
    expect(secondPoll.body).toEqual({ matches: [], count: 0 });
    expect(history.body.map((row) => row.source)).toEqual(["incoming", "like"]);
  });

  it("returns exactly one unseen match on poll and then none after it is marked seen", async () => {
    server = createServer({
      dbPath: ":memory:",
      scheduleIncomingLikes: false,
      now: createNowSequence(),
      random: () => 0.95,
      logger: { log() {} },
    });

    await request(server.app)
      .post("/api/decision")
      .send({ profileId: "super-one", decision: "superlike", profile: { name: "Casey" } });

    const firstPoll = await request(server.app).get("/api/matches/poll");
    const secondPoll = await request(server.app).get("/api/matches/poll");

    expect(firstPoll.body.count).toBe(1);
    expect(firstPoll.body.matches).toHaveLength(1);
    expect(firstPoll.body.matches[0].profileId).toBe("super-one");
    expect(secondPoll.body).toEqual({ matches: [], count: 0 });
  });

  it("returns decisions and matches in newest-first order", async () => {
    server = createServer({
      dbPath: ":memory:",
      scheduleIncomingLikes: false,
      now: createNowSequence(2_000),
      random: () => 0.1,
      logger: { log() {} },
    });

    await request(server.app).post("/api/decision").send({ profileId: "first", decision: "like" });
    await request(server.app).post("/api/decision").send({ profileId: "second", decision: "nope" });
    await request(server.app).post("/api/decision").send({ profileId: "third", decision: "superlike" });

    const decisions = await request(server.app).get("/api/decisions");
    const matches = await request(server.app).get("/api/matches");

    expect(decisions.body.map((row) => row.profileId)).toEqual(["third", "second", "first"]);
    expect(matches.body.map((row) => row.profileId)).toEqual(["third", "first"]);
  });

  it("clears decisions and matches from both populated and already-empty states", async () => {
    server = createServer({
      dbPath: ":memory:",
      scheduleIncomingLikes: false,
      now: createNowSequence(),
      random: () => 0.1,
      logger: { log() {} },
    });

    const emptyDelete = await request(server.app).delete("/api/decisions");
    await request(server.app).post("/api/decision").send({ profileId: "wipe-me", decision: "superlike" });
    const populatedDelete = await request(server.app).delete("/api/decisions");
    const decisions = await request(server.app).get("/api/decisions");
    const matches = await request(server.app).get("/api/matches");
    const stats = await request(server.app).get("/api/decisions/stats");

    expect(emptyDelete.body.success).toBe(true);
    expect(populatedDelete.body.success).toBe(true);
    expect(decisions.body).toEqual([]);
    expect(matches.body).toEqual([]);
    expect(stats.body).toEqual({ liked: 0, rejected: 0, superLiked: 0, total: 0 });
  });

  it("reports all-zero stats and single-class stats correctly", async () => {
    server = createServer({
      dbPath: ":memory:",
      scheduleIncomingLikes: false,
      now: createNowSequence(),
      random: () => 0.95,
      logger: { log() {} },
    });

    const emptyStats = await request(server.app).get("/api/decisions/stats");
    expect(emptyStats.body).toEqual({ liked: 0, rejected: 0, superLiked: 0, total: 0 });

    await request(server.app).post("/api/decision").send({ profileId: "only-nope", decision: "nope" });
    await request(server.app).post("/api/decision").send({ profileId: "only-nope-2", decision: "nope" });

    const nopeOnlyStats = await request(server.app).get("/api/decisions/stats");
    expect(nopeOnlyStats.body).toEqual({ liked: 0, rejected: 2, superLiked: 0, total: 2 });
  });
});
