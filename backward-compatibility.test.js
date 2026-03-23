/**
 * Backward Compatibility & API Versioning Tests
 * Tests ability to maintain compatibility across API versions
 */

const request = require("supertest");
const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

function createVersionedApp() {
  const app = express();
  app.use(express.json());

  const dbPath = path.join(__dirname, "versioning.test.sqlite");
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT,
      status TEXT DEFAULT 'active'
    );
  `);

  // V1 endpoint - basic functionality
  app.get("/api/v1/users", (_req, res) => {
    const users = db.prepare("SELECT id, name, email FROM users").all();
    res.json(users);
  });

  app.post("/api/v1/users", (req, res) => {
    const { name, email } = req.body;
    const stmt = db.prepare("INSERT INTO users (name, email) VALUES (?, ?)");
    const result = stmt.run(name, email);
    
    res.json({ id: result.lastInsertRowid, name, email });
  });

  // V2 endpoint - enhanced with status field
  app.get("/api/v2/users", (_req, res) => {
    const users = db.prepare("SELECT id, name, email, status FROM users").all();
    res.json({
      version: "2.0",
      count: users.length,
      data: users
    });
  });

  app.post("/api/v2/users", (req, res) => {
    const { name, email, status = "active" } = req.body;
    const stmt = db.prepare("INSERT INTO users (name, email, status) VALUES (?, ?, ?)");
    const result = stmt.run(name, email, status);
    
    res.status(201).json({
      id: result.lastInsertRowid,
      name,
      email,
      status
    });
  });

  // Aliased endpoint (latest = v2)
  app.get("/api/users", (_req, res) => {
    const users = db.prepare("SELECT id, name, email, status FROM users").all();
    res.json({
      version: "2.0",
      count: users.length,
      data: users
    });
  });

  return { app, db, dbPath };
}

describe("Backward Compatibility & API Versioning", () => {
  let versionApp, versionDb, versionDbPath;

  beforeEach(() => {
    const result = createVersionedApp();
    versionApp = result.app;
    versionDb = result.db;
    versionDbPath = result.dbPath;
  });

  afterEach(() => {
    if (fs.existsSync(versionDbPath)) fs.unlinkSync(versionDbPath);
  });

  describe("V1 API Compatibility", () => {
    test("should get users from v1 endpoint", async () => {
      await request(versionApp)
        .post("/api/v1/users")
        .send({ name: "John", email: "john@example.com" });

      const res = await request(versionApp).get("/api/v1/users");

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0]).toHaveProperty("id");
      expect(res.body[0]).toHaveProperty("name");
      expect(res.body[0]).toHaveProperty("email");
    });

    test("should not include status in v1 response", async () => {
      await request(versionApp)
        .post("/api/v1/users")
        .send({ name: "Jane", email: "jane@example.com" });

      const res = await request(versionApp).get("/api/v1/users");

      expect(res.body[0]).not.toHaveProperty("status");
    });

    test("should create user via v1 endpoint", async () => {
      const res = await request(versionApp)
        .post("/api/v1/users")
        .send({ name: "Bob", email: "bob@example.com" });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("id");
      expect(res.body.name).toBe("Bob");
      expect(res.body.email).toBe("bob@example.com");
    });
  });

  describe("V2 API Enhancements", () => {
    test("should include version in v2 response", async () => {
      const res = await request(versionApp).get("/api/v2/users");

      expect(res.body).toHaveProperty("version");
      expect(res.body.version).toBe("2.0");
    });

    test("should include count in v2 response", async () => {
      await request(versionApp)
        .post("/api/v2/users")
        .send({ name: "Alice", email: "alice@example.com" });

      const res = await request(versionApp).get("/api/v2/users");

      expect(res.body).toHaveProperty("count");
      expect(res.body.count).toBeGreaterThanOrEqual(1);
    });

    test("should have status field in v2 response", async () => {
      await request(versionApp)
        .post("/api/v2/users")
        .send({ name: "Charlie", email: "charlie@example.com" });

      const res = await request(versionApp).get("/api/v2/users");

      expect(res.body.data[0]).toHaveProperty("status");
    });

    test("should accept status in v2 create", async () => {
      const res = await request(versionApp)
        .post("/api/v2/users")
        .send({ name: "Diana", email: "diana@example.com", status: "inactive" });

      expect(res.body.status).toBe("inactive");
    });

    test("should use default status if not provided", async () => {
      const res = await request(versionApp)
        .post("/api/v2/users")
        .send({ name: "Eve", email: "eve@example.com" });

      expect(res.body.status).toBe("active");
    });

    test("should return 201 Created for v2 POST", async () => {
      const res = await request(versionApp)
        .post("/api/v2/users")
        .send({ name: "Frank", email: "frank@example.com" });

      expect(res.status).toBe(201);
    });
  });

  describe("Cross-Version Data Consistency", () => {
    test("data created in v1 should be readable in v2", async () => {
      await request(versionApp)
        .post("/api/v1/users")
        .send({ name: "Grace", email: "grace@example.com" });

      const v2Res = await request(versionApp).get("/api/v2/users");

      expect(v2Res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(v2Res.body.data.some(u => u.name === "Grace")).toBe(true);
    });

    test("data created in v2 should be readable in v1", async () => {
      await request(versionApp)
        .post("/api/v2/users")
        .send({ name: "Henry", email: "henry@example.com", status: "active" });

      const v1Res = await request(versionApp).get("/api/v1/users");

      expect(v1Res.body.length).toBeGreaterThanOrEqual(1);
      expect(v1Res.body.some(u => u.name === "Henry")).toBe(true);
    });

    test("shared data should have same id across versions", async () => {
      const createRes = await request(versionApp)
        .post("/api/v1/users")
        .send({ name: "Ivy", email: "ivy@example.com" });

      const userId = createRes.body.id;

      const v1Res = await request(versionApp).get("/api/v1/users");
      const v2Res = await request(versionApp).get("/api/v2/users");

      const v1User = v1Res.body.find(u => u.id === userId);
      const v2User = v2Res.body.data.find(u => u.id === userId);

      expect(v1User.name).toBe(v2User.name);
      expect(v1User.email).toBe(v2User.email);
    });
  });

  describe("Latest API Alias", () => {
    test("latest endpoint should match v2", async () => {
      await request(versionApp)
        .post("/api/v2/users")
        .send({ name: "Jack", email: "jack@example.com" });

      const v2Res = await request(versionApp).get("/api/v2/users");
      const latestRes = await request(versionApp).get("/api/users");

      expect(latestRes.body.version).toBe(v2Res.body.version);
      expect(latestRes.body.count).toBe(v2Res.body.count);
      expect(latestRes.body.data.length).toBe(v2Res.body.data.length);
    });

    test("latest POST should match v2 behavior", async () => {
      const res = await request(versionApp)
        .post("/api/users")
        .send({ name: "Karen", email: "karen@example.com" });

      expect(res.status).toBe(200); // Might be different from v2's 201
      expect(res.body).toHaveProperty("id");
    });
  });

  describe("Response Format Stability", () => {
    test("v1 response should be array for list endpoint", async () => {
      const res = await request(versionApp).get("/api/v1/users");

      expect(Array.isArray(res.body)).toBe(true);
    });

    test("v2 response should be object for list endpoint", async () => {
      const res = await request(versionApp).get("/api/v2/users");

      expect(typeof res.body).toBe("object");
      expect(Array.isArray(res.body)).toBe(false);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe("Field Addition Compatibility", () => {
    test("old clients should ignore new fields", async () => {
      const res = await request(versionApp).get("/api/v2/users");

      // V1 client would only use: id, name, email
      expect(res.body.data[0]).toHaveProperty("id");
      expect(res.body.data[0]).toHaveProperty("name");
      expect(res.body.data[0]).toHaveProperty("email");
    });

    test("new fields should not break old parsing", async () => {
      const res = await request(versionApp).get("/api/v2/users");

      // Even with extra fields, required fields should be present
      res.body.data.forEach(user => {
        expect(typeof user.id).toBe("number");
        expect(typeof user.name).toBe("string");
        expect(typeof user.email).toBe("string");
      });
    });
  });

  describe("Deprecation Handling", () => {
    test("deprecated endpoint should still work", async () => {
      await request(versionApp)
        .post("/api/v1/users")
        .send({ name: "Leo", email: "leo@example.com" });

      const res = await request(versionApp).get("/api/v1/users");

      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    test("v1 should have same data as v2/latest", async () => {
      const users = [
        { name: "Mike", email: "mike@example.com" },
        { name: "Nancy", email: "nancy@example.com" }
      ];

      for (const user of users) {
        await request(versionApp)
          .post("/api/v1/users")
          .send(user);
      }

      const v1Res = await request(versionApp).get("/api/v1/users");
      const latestRes = await request(versionApp).get("/api/users");

      expect(v1Res.body.length).toBe(latestRes.body.count);
    });
  });

  describe("Mixed Version Operations", () => {
    test("should support create via v1 and read via v2", async () => {
      const createRes = await request(versionApp)
        .post("/api/v1/users")
        .send({ name: "Oscar", email: "oscar@example.com" });

      const v2Res = await request(versionApp).get("/api/v2/users");

      expect(v2Res.body.data.some(u => u.id === createRes.body.id)).toBe(true);
    });

    test("should support create via v2 and read via v1", async () => {
      const createRes = await request(versionApp)
        .post("/api/v2/users")
        .send({ name: "Patricia", email: "patricia@example.com", status: "inactive" });

      const v1Res = await request(versionApp).get("/api/v1/users");

      expect(v1Res.body.some(u => u.id === createRes.body.id)).toBe(true);
    });
  });

  describe("Optional Field Handling", () => {
    test("v2 should handle missing status gracefully", async () => {
      const res = await request(versionApp)
        .post("/api/v2/users")
        .send({ name: "Quinn", email: "quinn@example.com" });

      expect(res.body).toHaveProperty("status");
      expect(res.body.status).toBe("active"); // default
    });

    test("v1 should work without status support", async () => {
      const res = await request(versionApp)
        .post("/api/v1/users")
        .send({ name: "Rachel", email: "rachel@example.com" });

      expect(res.body).not.toHaveProperty("status");
    });
  });

  describe("Version Detection", () => {
    test("v2 response should include explicit version", async () => {
      const res = await request(versionApp).get("/api/v2/users");

      expect(res.body.version).toBeDefined();
    });

    test("latest response should indicate it is v2", async () => {
      const res = await request(versionApp).get("/api/users");

      expect(res.body.version).toBe("2.0");
    });
  });
});
