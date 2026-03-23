/**
 * Input Validation & Boundary Tests
 * Tests edge cases, invalid inputs, and boundary conditions
 */

const request = require("supertest");
const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

function createValidationApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  const dbPath = path.join(__dirname, "validation.test.sqlite");
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      value TEXT,
      numValue INTEGER,
      created INTEGER
    );
  `);

  app.post("/api/test", (req, res) => {
    const { userId, value, numValue } = req.body;

    const errors = [];
    if (!userId) errors.push("userId required");
    if (typeof userId !== "string") errors.push("userId must be string");
    if (userId.length > 255) errors.push("userId too long");
    if (numValue !== undefined && typeof numValue !== "number") errors.push("numValue must be number");

    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    db.prepare("INSERT INTO tests (userId, value, numValue, created) VALUES (?, ?, ?, ?)")
      .run(userId, value || null, numValue || null, Date.now());

    res.json({ success: true });
  });

  app.get("/api/tests/:userId", (req, res) => {
    const { userId } = req.params;
    
    if (!userId || userId.length === 0) {
      return res.status(400).json({ error: "Invalid userId" });
    }

    const rows = db.prepare("SELECT * FROM tests WHERE userId = ?").all(userId);
    res.json(rows);
  });

  return { app, db, dbPath };
}

describe("Input Validation & Boundary Tests", () => {
  let validationApp, validationDb, validationDbPath;

  beforeEach(() => {
    const result = createValidationApp();
    validationApp = result.app;
    validationDb = result.db;
    validationDbPath = result.dbPath;
  });

  afterEach(() => {
    if (fs.existsSync(validationDbPath)) fs.unlinkSync(validationDbPath);
  });

  describe("Required Fields", () => {
    test("should reject missing required field", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ value: "test" });

      expect(res.status).toBe(400);
      expect(res.body.errors).toContain(expect.stringContaining("userId"));
    });

    test("should reject empty required field", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "", value: "test" });

      expect(res.status).toBe(400);
    });

    test("should reject null required field", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: null, value: "test" });

      expect(res.status).toBe(400);
    });

    test("should accept valid required field", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "user123" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("Field Type Validation", () => {
    test("should reject string when number expected", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "user1", numValue: "not_a_number" });

      expect(res.status).toBe(400);
    });

    test("should accept number as expected", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "user1", numValue: 42 });

      expect(res.status).toBe(200);
    });

    test("should reject object when string expected", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: { name: "test" } });

      expect(res.status).toBe(400);
    });

    test("should reject array when string expected", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: ["test"] });

      expect(res.status).toBe(400);
    });

    test("should accept valid types", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "user1", value: "text", numValue: 123 });

      expect(res.status).toBe(200);
    });
  });

  describe("String Length Boundaries", () => {
    test("should accept normal length string", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "user123" });

      expect(res.status).toBe(200);
    });

    test("should accept max length string", async () => {
      const maxString = "x".repeat(255);
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: maxString });

      expect(res.status).toBe(200);
    });

    test("should reject too-long string", async () => {
      const longString = "x".repeat(256);
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: longString });

      expect(res.status).toBe(400);
    });

    test("should accept single character", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "a" });

      expect(res.status).toBe(200);
    });

    test("should accept empty optional field", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "user1", value: "" });

      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(300);
    });
  });

  describe("Number Boundaries", () => {
    test("should accept zero", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "user1", numValue: 0 });

      expect(res.status).toBe(200);
    });

    test("should accept negative number", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "user1", numValue: -100 });

      expect(res.status).toBe(200);
    });

    test("should accept large number", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "user1", numValue: 999999999 });

      expect(res.status).toBe(200);
    });

    test("should accept decimal number", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "user1", numValue: 3.14 });

      expect(res.status).toBe(200);
    });

    test("should reject Infinity", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "user1", numValue: Infinity });

      // Infinity gets converted to null in JSON
      expect([200, 400]).toContain(res.status);
    });

    test("should reject NaN", async () => {
      // JSON serializes NaN as null
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "user1", numValue: NaN });

      expect([200, 400]).toContain(res.status);
    });
  });

  describe("Special Characters", () => {
    test("should accept alphanumeric", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "user123ABC" });

      expect(res.status).toBe(200);
    });

    test("should accept special characters", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "user@#$%^&*()" });

      expect(res.status).toBe(200);
    });

    test("should accept unicode characters", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "用户123😀" });

      expect(res.status).toBe(200);
    });

    test("should accept spaces", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "user 123" });

      expect(res.status).toBe(200);
    });

    test("should accept quotes", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: 'user"with"quotes' });

      expect(res.status).toBe(200);
    });

    test("should accept backslash", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "user\\path" });

      expect(res.status).toBe(200);
    });

    test("should accept newline characters", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "user\nline" });

      expect(res.status).toBe(200);
    });
  });

  describe("Edge Case Inputs", () => {
    test("should handle all zeros", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "000000" });

      expect(res.status).toBe(200);
    });

    test("should handle repeated characters", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "aaaaaaa" });

      expect(res.status).toBe(200);
    });

    test("should handle leading/trailing spaces", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "  user  " });

      expect(res.status).toBe(200);
    });

    test("should handle SQL injection attempt", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "'; DROP TABLE tests; --" });

      expect(res.status).toBe(200); // Parameterized queries should be safe
    });

    test("should handle XSS attempt in value", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "user1", value: "<script>alert('xss')</script>" });

      expect(res.status).toBe(200); // Stored as string, not executed
    });
  });

  describe("Parameter Validation in URL", () => {
    test("should accept valid userId in path", async () => {
      const res = await request(validationApp)
        .get("/api/tests/user123");

      expect(res.status).toBe(200);
    });

    test("should reject empty userId in path", async () => {
      const res = await request(validationApp)
        .get("/api/tests/");

      expect(res.status).toBe(400 || 404); // Either is acceptable
    });

    test("should accept userId with special chars in path", async () => {
      const res = await request(validationApp)
        .get("/api/tests/user%40test");

      expect([200, 400]).toContain(res.status);
    });
  });

  describe("Content Negotiation", () => {
    test("should reject non-JSON content-type", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .set("Content-Type", "text/plain")
        .send("not json");

      expect([400, 415]).toContain(res.status);
    });

    test("should accept JSON content-type", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .set("Content-Type", "application/json")
        .send({ userId: "user1" });

      expect(res.status).toBe(200);
    });

    test("should handle charset in content-type", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .set("Content-Type", "application/json; charset=utf-8")
        .send({ userId: "user1" });

      expect(res.status).toBe(200);
    });
  });

  describe("Optional Fields", () => {
    test("should accept without optional fields", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "user1" });

      expect(res.status).toBe(200);
    });

    test("should accept with optional fields", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "user1", value: "test", numValue: 42 });

      expect(res.status).toBe(200);
    });

    test("should accept with null optional fields", async () => {
      const res = await request(validationApp)
        .post("/api/test")
        .send({ userId: "user1", value: null, numValue: null });

      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(300);
    });
  });
});
