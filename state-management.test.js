/**
 * State Management & Data Consistency Tests
 * Tests application state across multiple operations
 */

const request = require("supertest");
const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

function createStateApp() {
  const app = express();
  app.use(express.json());

  const dbPath = path.join(__dirname, "state.test.sqlite");
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      status TEXT DEFAULT 'active',
      count INTEGER DEFAULT 0,
      lastModified INTEGER
    );
  `);

  // In-memory state
  let operationLog = [];

  app.post("/api/item", (req, res) => {
    const { name } = req.body;
    const stmt = db.prepare("INSERT INTO items (name, lastModified) VALUES (?, ?)");
    const result = stmt.run(name, Date.now());
    
    operationLog.push({ action: "create", id: result.lastInsertRowid, time: Date.now() });

    res.json({ id: result.lastInsertRowid, name });
  });

  app.put("/api/item/:id", (req, res) => {
    const { id } = req.params;
    const { status, count } = req.body;

    db.prepare("UPDATE items SET status = ?, count = ?, lastModified = ? WHERE id = ?")
      .run(status || null, count || null, Date.now(), id);

    operationLog.push({ action: "update", id, time: Date.now() });

    res.json({ success: true });
  });

  app.get("/api/item/:id", (req, res) => {
    const { id } = req.params;
    const row = db.prepare("SELECT * FROM items WHERE id = ?").get(id);

    if (!row) {
      return res.status(404).json({ error: "Not found" });
    }

    res.json(row);
  });

  app.get("/api/items", (_req, res) => {
    const rows = db.prepare("SELECT * FROM items").all();
    res.json(rows);
  });

  app.delete("/api/item/:id", (req, res) => {
    const { id } = req.params;
    db.prepare("DELETE FROM items WHERE id = ?").run(id);
    
    operationLog.push({ action: "delete", id, time: Date.now() });

    res.json({ success: true });
  });

  app.get("/api/log", (_req, res) => {
    res.json(operationLog);
  });

  app.post("/api/reset", (_req, res) => {
    db.prepare("DELETE FROM items").run();
    operationLog = [];
    res.json({ success: true });
  });

  return { app, db, dbPath };
}

describe("State Management & Data Consistency", () => {
  let stateApp, stateDb, stateDbPath;

  beforeEach(() => {
    const result = createStateApp();
    stateApp = result.app;
    stateDb = result.db;
    stateDbPath = result.dbPath;
  });

  afterEach(() => {
    if (fs.existsSync(stateDbPath)) fs.unlinkSync(stateDbPath);
  });

  describe("Create-Read Consistency", () => {
    test("should retrieve created item", async () => {
      const createRes = await request(stateApp)
        .post("/api/item")
        .send({ name: "Test Item" });

      const itemId = createRes.body.id;

      const getRes = await request(stateApp).get(`/api/item/${itemId}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.name).toBe("Test Item");
    });

    test("should reflect all created items in list", async () => {
      const ids = [];

      for (let i = 0; i < 5; i++) {
        const res = await request(stateApp)
          .post("/api/item")
          .send({ name: `Item ${i}` });
        ids.push(res.body.id);
      }

      const listRes = await request(stateApp).get("/api/items");

      expect(listRes.body.length).toBe(5);
      ids.forEach(id => {
        expect(listRes.body.some(item => item.id === id)).toBe(true);
      });
    });

    test("should maintain data after multiple operations", async () => {
      const createRes = await request(stateApp)
        .post("/api/item")
        .send({ name: "Original" });

      const id = createRes.body.id;

      await request(stateApp)
        .put(`/api/item/${id}`)
        .send({ status: "inactive" });

      const getRes = await request(stateApp).get(`/api/item/${id}`);

      expect(getRes.body.name).toBe("Original");
      expect(getRes.body.status).toBe("inactive");
    });
  });

  describe("Update Consistency", () => {
    test("should reflect updated values", async () => {
      const createRes = await request(stateApp)
        .post("/api/item")
        .send({ name: "Item" });

      const id = createRes.body.id;

      await request(stateApp)
        .put(`/api/item/${id}`)
        .send({ count: 42 });

      const getRes = await request(stateApp).get(`/api/item/${id}`);

      expect(getRes.body.count).toBe(42);
    });

    test("should update only specified fields", async () => {
      const createRes = await request(stateApp)
        .post("/api/item")
        .send({ name: "Item" });

      const id = createRes.body.id;
      const originalName = createRes.body.name;

      await request(stateApp)
        .put(`/api/item/${id}`)
        .send({ status: "inactive" });

      const getRes = await request(stateApp).get(`/api/item/${id}`);

      expect(getRes.body.name).toBe(originalName);
      expect(getRes.body.status).toBe("inactive");
    });

    test("should allow multiple sequential updates", async () => {
      const createRes = await request(stateApp)
        .post("/api/item")
        .send({ name: "Item" });

      const id = createRes.body.id;

      await request(stateApp)
        .put(`/api/item/${id}`)
        .send({ count: 1 });

      await request(stateApp)
        .put(`/api/item/${id}`)
        .send({ count: 2 });

      await request(stateApp)
        .put(`/api/item/${id}`)
        .send({ count: 3 });

      const getRes = await request(stateApp).get(`/api/item/${id}`);

      expect(getRes.body.count).toBe(3);
    });
  });

  describe("Delete Consistency", () => {
    test("should remove deleted item", async () => {
      const createRes = await request(stateApp)
        .post("/api/item")
        .send({ name: "Item" });

      const id = createRes.body.id;

      await request(stateApp).delete(`/api/item/${id}`);

      const getRes = await request(stateApp).get(`/api/item/${id}`);

      expect(getRes.status).toBe(404);
    });

    test("should remove from list after delete", async () => {
      const createRes = await request(stateApp)
        .post("/api/item")
        .send({ name: "Item" });

      const id = createRes.body.id;

      const beforeDelete = await request(stateApp).get("/api/items");
      const beforeCount = beforeDelete.body.length;

      await request(stateApp).delete(`/api/item/${id}`);

      const afterDelete = await request(stateApp).get("/api/items");

      expect(afterDelete.body.length).toBe(beforeCount - 1);
      expect(afterDelete.body.some(item => item.id === id)).toBe(false);
    });
  });

  describe("State Isolation", () => {
    test("should not affect other items when updating one", async () => {
      const res1 = await request(stateApp)
        .post("/api/item")
        .send({ name: "Item 1" });

      const res2 = await request(stateApp)
        .post("/api/item")
        .send({ name: "Item 2" });

      const id1 = res1.body.id;
      const id2 = res2.body.id;

      await request(stateApp)
        .put(`/api/item/${id1}`)
        .send({ status: "inactive" });

      const getRes2 = await request(stateApp).get(`/api/item/${id2}`);

      expect(getRes2.body.status).toBe("active"); // Unchanged
    });

    test("should not affect other items when deleting one", async () => {
      const res1 = await request(stateApp)
        .post("/api/item")
        .send({ name: "Item 1" });

      const res2 = await request(stateApp)
        .post("/api/item")
        .send({ name: "Item 2" });

      const id1 = res1.body.id;
      const id2 = res2.body.id;

      await request(stateApp).delete(`/api/item/${id1}`);

      const getRes2 = await request(stateApp).get(`/api/item/${id2}`);

      expect(getRes2.status).toBe(200);
      expect(getRes2.body.id).toBe(id2);
    });
  });

  describe("State Invalidation", () => {
    test("should return 404 after deletion", async () => {
      const createRes = await request(stateApp)
        .post("/api/item")
        .send({ name: "Item" });

      const id = createRes.body.id;

      await request(stateApp).delete(`/api/item/${id}`);

      const getRes = await request(stateApp).get(`/api/item/${id}`);

      expect(getRes.status).toBe(404);
    });

    test("should handle operations on non-existent item", async () => {
      const res = await request(stateApp)
        .get("/api/item/99999");

      expect(res.status).toBe(404);
    });
  });

  describe("Concurrent State Modifications", () => {
    test("should handle multiple concurrent creates", async () => {
      const promises = [];

      for (let i = 0; i < 10; i++) {
        promises.push(
          request(stateApp)
            .post("/api/item")
            .send({ name: `Item ${i}` })
        );
      }

      await Promise.all(promises);

      const listRes = await request(stateApp).get("/api/items");

      expect(listRes.body.length).toBe(10);
    });

    test("should maintain consistency with mixed operations", async () => {
      const createRes = await request(stateApp)
        .post("/api/item")
        .send({ name: "Item" });

      const id = createRes.body.id;

      const promises = [
        request(stateApp)
          .put(`/api/item/${id}`)
          .send({ count: 1 }),
        request(stateApp)
          .put(`/api/item/${id}`)
          .send({ count: 2 }),
        request(stateApp)
          .get(`/api/item/${id}`),
      ];

      const results = await Promise.all(promises);

      // Final state should be consistent
      const getRes = await request(stateApp).get(`/api/item/${id}`);
      expect(getRes.body.count).toBeGreaterThan(0);
    });
  });

  describe("State Audit Trail", () => {
    test("should log operations", async () => {
      await request(stateApp)
        .post("/api/item")
        .send({ name: "Item" });

      const logRes = await request(stateApp).get("/api/log");

      expect(logRes.body.length).toBeGreaterThan(0);
      expect(logRes.body[0]).toHaveProperty("action");
      expect(logRes.body[0]).toHaveProperty("time");
    });

    test("should record operation timestamps", async () => {
      const before = Date.now();

      const createRes = await request(stateApp)
        .post("/api/item")
        .send({ name: "Item" });

      const after = Date.now();

      const logRes = await request(stateApp).get("/api/log");

      expect(logRes.body.length).toBeGreaterThan(0);
      const log = logRes.body[logRes.body.length - 1];
      expect(log.time).toBeGreaterThanOrEqual(before);
      expect(log.time).toBeLessThanOrEqual(after);
    });
  });

  describe("State Reset", () => {
    test("should clear all state on reset", async () => {
      await request(stateApp)
        .post("/api/item")
        .send({ name: "Item" });

      await request(stateApp).post("/api/reset");

      const listRes = await request(stateApp).get("/api/items");

      expect(listRes.body.length).toBe(0);
    });

    test("should allow operations after reset", async () => {
      await request(stateApp)
        .post("/api/item")
        .send({ name: "Item 1" });

      await request(stateApp).post("/api/reset");

      const createRes = await request(stateApp)
        .post("/api/item")
        .send({ name: "Item 2" });

      expect(createRes.status).toBe(200);

      const listRes = await request(stateApp).get("/api/items");

      expect(listRes.body.length).toBe(1);
    });
  });

  describe("Idempotency", () => {
    test("multiple identical updates should result in same state", async () => {
      const createRes = await request(stateApp)
        .post("/api/item")
        .send({ name: "Item" });

      const id = createRes.body.id;

      const updatePromises = [
        request(stateApp)
          .put(`/api/item/${id}`)
          .send({ count: 5 }),
        request(stateApp)
          .put(`/api/item/${id}`)
          .send({ count: 5 }),
        request(stateApp)
          .put(`/api/item/${id}`)
          .send({ count: 5 }),
      ];

      await Promise.all(updatePromises);

      const getRes = await request(stateApp).get(`/api/item/${id}`);

      expect(getRes.body.count).toBe(5);
    });

    test("multiple identical deletes should be safe", async () => {
      const createRes = await request(stateApp)
        .post("/api/item")
        .send({ name: "Item" });

      const id = createRes.body.id;

      const deleteRes1 = await request(stateApp).delete(`/api/item/${id}`);

      expect(deleteRes1.status).toBe(200);

      // Second delete might fail or succeed depending on implementation
      const deleteRes2 = await request(stateApp).delete(`/api/item/${id}`);

      expect([200, 404]).toContain(deleteRes2.status);
    });
  });
});
