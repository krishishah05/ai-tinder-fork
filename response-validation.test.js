/**
 * API Response Validation Tests
 * Tests response structure, headers, and content types
 */

const request = require("supertest");
const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

function createResponseTestApp() {
  const app = express();
  app.use(express.json());

  const dbPath = path.join(__dirname, "response.test.sqlite");
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profileId TEXT NOT NULL,
      decision TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
  `);

  app.post("/api/decision", (req, res) => {
    const { profileId, decision } = req.body;
    if (!profileId) return res.status(400).json({ error: "Missing profileId" });
    
    db.prepare("INSERT INTO decisions (profileId, decision, timestamp) VALUES (?, ?, ?)")
      .run(profileId, decision, Date.now());
    
    res.json({ success: true, decision, timestamp: Date.now() });
  });

  app.get("/api/decisions", (_req, res) => {
    const rows = db.prepare("SELECT * FROM decisions").all();
    res.json(rows);
  });

  return { app, db, dbPath };
}

describe("API Response Validation", () => {
  let responseApp, responseDb, responseDbPath;

  beforeEach(() => {
    const result = createResponseTestApp();
    responseApp = result.app;
    responseDb = result.db;
    responseDbPath = result.dbPath;
  });

  afterEach(() => {
    if (fs.existsSync(responseDbPath)) fs.unlinkSync(responseDbPath);
  });

  describe("Response Structure", () => {
    test("should return JSON object for success response", async () => {
      const res = await request(responseApp)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "like" });

      expect(res.body).toBeInstanceOf(Object);
      expect(res.body).not.toBeInstanceOf(Array);
    });

    test("should return JSON array for GET decisions", async () => {
      const res = await request(responseApp).get("/api/decisions");
      expect(Array.isArray(res.body)).toBe(true);
    });

    test("should include required fields in success response", async () => {
      const res = await request(responseApp)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "like" });

      expect(res.body).toHaveProperty("success");
      expect(res.body).toHaveProperty("decision");
      expect(res.body).toHaveProperty("timestamp");
    });

    test("should include error field in error response", async () => {
      const res = await request(responseApp)
        .post("/api/decision")
        .send({ decision: "like" });

      expect(res.body).toHaveProperty("error");
      expect(typeof res.body.error).toBe("string");
    });

    test("should have consistent response structure across calls", async () => {
      const res1 = await request(responseApp)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "like" });

      const res2 = await request(responseApp)
        .post("/api/decision")
        .send({ profileId: "p2", decision: "nope" });

      expect(Object.keys(res1.body).sort()).toEqual(Object.keys(res2.body).sort());
    });
  });

  describe("HTTP Status Codes", () => {
    test("should return 200 for successful POST", async () => {
      const res = await request(responseApp)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "like" });

      expect(res.status).toBe(200);
    });

    test("should return 200 for successful GET", async () => {
      const res = await request(responseApp).get("/api/decisions");
      expect(res.status).toBe(200);
    });

    test("should return 400 for invalid request", async () => {
      const res = await request(responseApp)
        .post("/api/decision")
        .send({});

      expect(res.status).toBe(400);
    });

    test("should return 404 for non-existent endpoint", async () => {
      const res = await request(responseApp).get("/api/nonexistent");
      expect(res.status).toBe(404);
    });

    test("error response should have appropriate status code", async () => {
      const responses = [];

      responses.push(
        await request(responseApp)
          .post("/api/decision")
          .send({})
      );

      responses.forEach(res => {
        expect([400, 422, 500]).toContain(res.status);
      });
    });
  });

  describe("Content-Type Headers", () => {
    test("should return application/json content-type", async () => {
      const res = await request(responseApp).get("/api/decisions");
      expect(res.headers["content-type"]).toContain("application/json");
    });

    test("should accept application/json", async () => {
      const res = await request(responseApp)
        .post("/api/decision")
        .set("Content-Type", "application/json")
        .send({ profileId: "p1", decision: "like" });

      expect(res.status).toBe(200);
    });

    test("POST response should have JSON content-type", async () => {
      const res = await request(responseApp)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "like" });

      expect(res.headers["content-type"]).toContain("application/json");
    });
  });

  describe("Response Data Types", () => {
    test("success boolean should be true for success", async () => {
      const res = await request(responseApp)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "like" });

      expect(typeof res.body.success).toBe("boolean");
      expect(res.body.success).toBe(true);
    });

    test("decision should be a string", async () => {
      const res = await request(responseApp)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "like" });

      expect(typeof res.body.decision).toBe("string");
    });

    test("timestamp should be a number", async () => {
      const res = await request(responseApp)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "like" });

      expect(typeof res.body.timestamp).toBe("number");
      expect(Number.isInteger(res.body.timestamp)).toBe(true);
      expect(res.body.timestamp).toBeGreaterThan(0);
    });

    test("array elements should have correct types", async () => {
      await request(responseApp)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "like" });

      const res = await request(responseApp).get("/api/decisions");

      expect(res.body.length).toBeGreaterThan(0);
      res.body.forEach(item => {
        expect(typeof item.id).toBe("number");
        expect(typeof item.profileId).toBe("string");
        expect(typeof item.decision).toBe("string");
        expect(typeof item.timestamp).toBe("number");
      });
    });

    test("error field should be string", async () => {
      const res = await request(responseApp)
        .post("/api/decision")
        .send({});

      expect(typeof res.body.error).toBe("string");
      expect(res.body.error.length).toBeGreaterThan(0);
    });
  });

  describe("Response Validation", () => {
    test("should not have null values in success response", async () => {
      const res = await request(responseApp)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "like" });

      Object.values(res.body).forEach(value => {
        expect(value).not.toBeNull();
      });
    });

    test("should not include sensitive data in response", async () => {
      const res = await request(responseApp).get("/api/decisions");

      res.body.forEach(decision => {
        expect(decision).not.toHaveProperty("password");
        expect(decision).not.toHaveProperty("secret");
        expect(decision).not.toHaveProperty("apiKey");
      });
    });

    test("timestamp should be recent", async () => {
      const before = Date.now();
      const res = await request(responseApp)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "like" });
      const after = Date.now();

      expect(res.body.timestamp).toBeGreaterThanOrEqual(before);
      expect(res.body.timestamp).toBeLessThanOrEqual(after);
    });

    test("should handle empty arrays properly", async () => {
      const res = await request(responseApp).get("/api/decisions");

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });

    test("should validate all required fields present", async () => {
      await request(responseApp)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "like" });

      const res = await request(responseApp).get("/api/decisions");

      const requiredFields = ["id", "profileId", "decision", "timestamp"];
      res.body.forEach(item => {
        requiredFields.forEach(field => {
          expect(item).toHaveProperty(field);
        });
      });
    });
  });

  describe("Response Edge Cases", () => {
    test("should handle missing optional fields gracefully", async () => {
      const res = await request(responseApp)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "like" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test("should not include extra fields in response", async () => {
      const res = await request(responseApp)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "like", extra: "field" });

      expect(res.body).not.toHaveProperty("extra");
    });

    test("should handle special characters in response data", async () => {
      const res = await request(responseApp)
        .post("/api/decision")
        .send({ profileId: "p@#$%", decision: "like" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test("should handle very long strings", async () => {
      const longId = "p_" + "x".repeat(1000);
      const res = await request(responseApp)
        .post("/api/decision")
        .send({ profileId: longId, decision: "like" });

      expect(res.status).toBe(200);
    });
  });

  describe("Response Size", () => {
    test("single response should be reasonably sized", async () => {
      const res = await request(responseApp)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "like" });

      const size = JSON.stringify(res.body).length;
      expect(size).toBeLessThan(1000); // Less than 1KB
    });

    test("large array response should be reasonable", async () => {
      for (let i = 0; i < 50; i++) {
        await request(responseApp)
          .post("/api/decision")
          .send({ profileId: `p${i}`, decision: "like" });
      }

      const res = await request(responseApp).get("/api/decisions");
      const size = JSON.stringify(res.body).length;

      expect(size).toBeLessThan(500 * 1024); // Less than 500KB
    });
  });
});
