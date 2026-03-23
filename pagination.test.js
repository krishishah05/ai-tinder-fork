/**
 * Pagination & Cursor-Based Navigation Tests
 * Tests paginated responses and cursor navigation
 */

const request = require("supertest");
const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

function createPaginationApp() {
  const app = express();
  app.use(express.json());

  const dbPath = path.join(__dirname, "pagination.test.sqlite");
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      createdAt INTEGER,
      value INTEGER
    );
  `);

  // Insert 100 test items
  const insertStmt = db.prepare(
    "INSERT INTO items (title, description, createdAt, value) VALUES (?, ?, ?, ?)"
  );

  for (let i = 1; i <= 100; i++) {
    insertStmt.run(
      `Item ${i}`,
      `Description for item ${i}`,
      Date.now() - (100 - i) * 1000,
      i * 10
    );
  }

  // Offset-based pagination
  app.get("/api/items-offset", (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 10));
    const offset = (page - 1) * pageSize;

    const total = db.prepare("SELECT COUNT(*) as count FROM items").get().count;
    const items = db.prepare(`SELECT * FROM items ORDER BY id ASC LIMIT ? OFFSET ?`)
      .all(pageSize, offset);

    const totalPages = Math.ceil(total / pageSize);

    res.json({
      data: items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      }
    });
  });

  // Cursor-based pagination
  app.get("/api/items-cursor", (req, res) => {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const cursor = req.query.cursor ? parseInt(req.query.cursor) : 0;

    // Get items after cursor
    let items = db.prepare(`SELECT * FROM items WHERE id > ? ORDER BY id ASC LIMIT ?`)
      .all(cursor, limit + 1);

    const hasMore = items.length > limit;
    if (hasMore) {
      items = items.slice(0, limit);
    }

    const nextCursor = items.length > 0 ? items[items.length - 1].id : null;

    res.json({
      data: items,
      pagination: {
        cursor: nextCursor,
        hasMore: hasMore,
        limit
      }
    });
  });

  // Keyset pagination (seek method)
  app.get("/api/items-keyset", (req, res) => {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const afterId = req.query.afterId ? parseInt(req.query.afterId) : 0;
    const afterValue = req.query.afterValue ? parseInt(req.query.afterValue) : -1;

    let items = db.prepare(`
      SELECT * FROM items 
      WHERE (value > ? OR (value = ? AND id > ?))
      ORDER BY value ASC, id ASC
      LIMIT ?
    `).all(afterValue, afterValue, afterId, limit + 1);

    const hasMore = items.length > limit;
    if (hasMore) {
      items = items.slice(0, limit);
    }

    let nextAfter = null;
    if (items.length > 0) {
      const lastItem = items[items.length - 1];
      nextAfter = {
        id: lastItem.id,
        value: lastItem.value
      };
    }

    res.json({
      data: items,
      pagination: {
        afterId: nextAfter?.id,
        afterValue: nextAfter?.value,
        hasMore: hasMore,
        limit
      }
    });
  });

  // Link-based pagination
  app.get("/api/items-links", (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize) || 10));
    const offset = (page - 1) * pageSize;

    const total = db.prepare("SELECT COUNT(*) as count FROM items").get().count;
    const items = db.prepare(`SELECT * FROM items ORDER BY id ASC LIMIT ? OFFSET ?`)
      .all(pageSize, offset);

    const totalPages = Math.ceil(total / pageSize);

    const links = {
      self: `/api/items-links?page=${page}&pageSize=${pageSize}`
    };

    if (page < totalPages) {
      links.next = `/api/items-links?page=${page + 1}&pageSize=${pageSize}`;
    }

    if (page > 1) {
      links.previous = `/api/items-links?page=${page - 1}&pageSize=${pageSize}`;
    }

    links.first = `/api/items-links?page=1&pageSize=${pageSize}`;
    links.last = `/api/items-links?page=${totalPages}&pageSize=${pageSize}`;

    res.json({
      data: items,
      links,
      pagination: {
        page,
        pageSize,
        total,
        totalPages
      }
    });
  });

  // Sorted pagination
  app.get("/api/items-sorted", (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize) || 10));
    const sortBy = req.query.sortBy || "id";
    const order = req.query.order === "desc" ? "DESC" : "ASC";

    const validFields = ["id", "title", "createdAt", "value"];
    if (!validFields.includes(sortBy)) {
      return res.status(400).json({ error: "Invalid sortBy field" });
    }

    const total = db.prepare("SELECT COUNT(*) as count FROM items").get().count;
    const offset = (page - 1) * pageSize;

    const items = db.prepare(`SELECT * FROM items ORDER BY ${sortBy} ${order} LIMIT ? OFFSET ?`)
      .all(pageSize, offset);

    const totalPages = Math.ceil(total / pageSize);

    res.json({
      data: items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        sortBy,
        order
      }
    });
  });

  return { app, db, dbPath };
}

describe("Pagination & Cursor-Based Navigation", () => {
  let paginationApp, paginationDb, paginationDbPath;

  beforeEach(() => {
    const result = createPaginationApp();
    paginationApp = result.app;
    paginationDb = result.db;
    paginationDbPath = result.dbPath;
  });

  afterEach(() => {
    if (fs.existsSync(paginationDbPath)) fs.unlinkSync(paginationDbPath);
  });

  describe("Offset-Based Pagination", () => {
    test("should return first page", async () => {
      const res = await request(paginationApp)
        .get("/api/items-offset")
        .query({ page: 1, pageSize: 10 });

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(10);
      expect(res.body.pagination.page).toBe(1);
    });

    test("should return specific page", async () => {
      const res = await request(paginationApp)
        .get("/api/items-offset")
        .query({ page: 3, pageSize: 10 });

      expect(res.body.data.length).toBe(10);
      expect(res.body.pagination.page).toBe(3);
      expect(res.body.data[0].id).toBe(21);
    });

    test("should handle custom page size", async () => {
      const res = await request(paginationApp)
        .get("/api/items-offset")
        .query({ page: 1, pageSize: 25 });

      expect(res.body.data.length).toBe(25);
      expect(res.body.pagination.pageSize).toBe(25);
    });

    test("should return metadata", async () => {
      const res = await request(paginationApp)
        .get("/api/items-offset")
        .query({ page: 1, pageSize: 10 });

      expect(res.body.pagination).toHaveProperty("page");
      expect(res.body.pagination).toHaveProperty("pageSize");
      expect(res.body.pagination).toHaveProperty("total");
      expect(res.body.pagination).toHaveProperty("totalPages");
    });

    test("should indicate hasNextPage", async () => {
      const res1 = await request(paginationApp)
        .get("/api/items-offset")
        .query({ page: 1, pageSize: 10 });

      expect(res1.body.pagination.hasNextPage).toBe(true);

      const res10 = await request(paginationApp)
        .get("/api/items-offset")
        .query({ page: 10, pageSize: 10 });

      expect(res10.body.pagination.hasNextPage).toBe(false);
    });

    test("should indicate hasPreviousPage", async () => {
      const res1 = await request(paginationApp)
        .get("/api/items-offset")
        .query({ page: 1, pageSize: 10 });

      expect(res1.body.pagination.hasPreviousPage).toBe(false);

      const res2 = await request(paginationApp)
        .get("/api/items-offset")
        .query({ page: 2, pageSize: 10 });

      expect(res2.body.pagination.hasPreviousPage).toBe(true);
    });

    test("should return last page correctly", async () => {
      const res = await request(paginationApp)
        .get("/api/items-offset")
        .query({ page: 10, pageSize: 10 });

      expect(res.body.data.length).toBe(10);
      expect(res.body.pagination.page).toBe(10);
    });

    test("should return empty for out-of-bounds page", async () => {
      const res = await request(paginationApp)
        .get("/api/items-offset")
        .query({ page: 1000, pageSize: 10 });

      expect(res.body.data.length).toBe(0);
    });

    test("should enforce maximum page size", async () => {
      const res = await request(paginationApp)
        .get("/api/items-offset")
        .query({ page: 1, pageSize: 1000 });

      expect(res.body.data.length).toBeLessThanOrEqual(100);
    });
  });

  describe("Cursor-Based Pagination", () => {
    test("should return first page without cursor", async () => {
      const res = await request(paginationApp)
        .get("/api/items-cursor")
        .query({ limit: 10 });

      expect(res.body.data.length).toBeLessThanOrEqual(10);
      expect(res.body.pagination.cursor).toBeDefined();
    });

    test("should use cursor for next page", async () => {
      const res1 = await request(paginationApp)
        .get("/api/items-cursor")
        .query({ limit: 10 });

      const cursor = res1.body.pagination.cursor;

      const res2 = await request(paginationApp)
        .get("/api/items-cursor")
        .query({ limit: 10, cursor });

      expect(res2.body.data[0].id).toBeGreaterThan(res1.body.data[0].id);
    });

    test("should indicate hasMore", async () => {
      const res = await request(paginationApp)
        .get("/api/items-cursor")
        .query({ limit: 10 });

      expect(res.body.pagination).toHaveProperty("hasMore");
      expect(typeof res.body.pagination.hasMore).toBe("boolean");
    });

    test("should traverse all items with cursor", async () => {
      const items = [];
      let cursor = null;
      let hasMore = true;

      while (hasMore) {
        const query = { limit: 20 };
        if (cursor) {
          query.cursor = cursor;
        }

        const res = await request(paginationApp)
          .get("/api/items-cursor")
          .query(query);

        items.push(...res.body.data);
        cursor = res.body.pagination.cursor;
        hasMore = res.body.pagination.hasMore;

        if (items.length > 150) break; // Safety break
      }

      expect(items.length).toBe(100);
    });

    test("should not repeat items across pages", async () => {
      const res1 = await request(paginationApp)
        .get("/api/items-cursor")
        .query({ limit: 20 });

      const cursor = res1.body.pagination.cursor;

      const res2 = await request(paginationApp)
        .get("/api/items-cursor")
        .query({ limit: 20, cursor });

      const ids1 = res1.body.data.map(i => i.id);
      const ids2 = res2.body.data.map(i => i.id);

      const overlap = ids1.filter(id => ids2.includes(id));
      expect(overlap.length).toBe(0);
    });
  });

  describe("Keyset Pagination", () => {
    test("should return first page without keyset", async () => {
      const res = await request(paginationApp)
        .get("/api/items-keyset")
        .query({ limit: 10 });

      expect(res.body.data.length).toBeLessThanOrEqual(10);
    });

    test("should use keyset for next page", async () => {
      const res1 = await request(paginationApp)
        .get("/api/items-keyset")
        .query({ limit: 10 });

      const last = res1.body.data[res1.body.data.length - 1];

      const res2 = await request(paginationApp)
        .get("/api/items-keyset")
        .query({
          limit: 10,
          afterValue: last.value,
          afterId: last.id
        });

      expect(res2.body.data[0].value).toBeGreaterThanOrEqual(last.value);
    });

    test("should handle ties with keyset", async () => {
      const res = await request(paginationApp)
        .get("/api/items-keyset")
        .query({ limit: 100 }); // Get all to verify sorting

      const values = res.body.data.map(i => i.value);

      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
      }
    });
  });

  describe("Link-Based Pagination", () => {
    test("should include link headers", async () => {
      const res = await request(paginationApp)
        .get("/api/items-links")
        .query({ page: 1, pageSize: 10 });

      expect(res.body.links).toHaveProperty("self");
      expect(res.body.links).toHaveProperty("first");
      expect(res.body.links).toHaveProperty("last");
    });

    test("should include next link when available", async () => {
      const res = await request(paginationApp)
        .get("/api/items-links")
        .query({ page: 1, pageSize: 10 });

      expect(res.body.links).toHaveProperty("next");
    });

    test("should not include next link on last page", async () => {
      const res = await request(paginationApp)
        .get("/api/items-links")
        .query({ page: 10, pageSize: 10 });

      expect(res.body.links.next).toBeUndefined();
    });

    test("should include previous link when available", async () => {
      const res = await request(paginationApp)
        .get("/api/items-links")
        .query({ page: 2, pageSize: 10 });

      expect(res.body.links).toHaveProperty("previous");
    });

    test("should not include previous link on first page", async () => {
      const res = await request(paginationApp)
        .get("/api/items-links")
        .query({ page: 1, pageSize: 10 });

      expect(res.body.links.previous).toBeUndefined();
    });

    test("should provide valid navigation links", async () => {
      const res1 = await request(paginationApp)
        .get("/api/items-links")
        .query({ page: 1, pageSize: 10 });

      const nextLink = res1.body.links.next;
      expect(nextLink).toContain("page=2");

      const lastLink = res1.body.links.last;
      expect(lastLink).toContain("page=10");
    });
  });

  describe("Sorted Pagination", () => {
    test("should sort by specified field", async () => {
      const res = await request(paginationApp)
        .get("/api/items-sorted")
        .query({ page: 1, pageSize: 10, sortBy: "value" });

      const values = res.body.data.map(i => i.value);

      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
      }
    });

    test("should support descending sort", async () => {
      const res = await request(paginationApp)
        .get("/api/items-sorted")
        .query({ page: 1, pageSize: 10, sortBy: "value", order: "desc" });

      const values = res.body.data.map(i => i.value);

      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
      }
    });

    test("should reject invalid sortBy field", async () => {
      const res = await request(paginationApp)
        .get("/api/items-sorted")
        .query({ page: 1, pageSize: 10, sortBy: "invalid" });

      expect(res.status).toBe(400);
    });
  });

  describe("Pagination Consistency", () => {
    test("should maintain consistent ordering across pages", async () => {
      const page1 = await request(paginationApp)
        .get("/api/items-offset")
        .query({ page: 1, pageSize: 10 });

      const page2 = await request(paginationApp)
        .get("/api/items-offset")
        .query({ page: 2, pageSize: 10 });

      const lastPage1 = page1.body.data[9];
      const firstPage2 = page2.body.data[0];

      expect(firstPage2.id).toBeGreaterThan(lastPage1.id);
    });

    test("should return same results for same page", async () => {
      const res1 = await request(paginationApp)
        .get("/api/items-offset")
        .query({ page: 2, pageSize: 10 });

      const res2 = await request(paginationApp)
        .get("/api/items-offset")
        .query({ page: 2, pageSize: 10 });

      expect(res1.body.data).toEqual(res2.body.data);
    });
  });

  describe("Edge Cases", () => {
    test("should handle page size of 1", async () => {
      const res = await request(paginationApp)
        .get("/api/items-offset")
        .query({ page: 1, pageSize: 1 });

      expect(res.body.data.length).toBe(1);
    });

    test("should handle very large page size", async () => {
      const res = await request(paginationApp)
        .get("/api/items-offset")
        .query({ page: 1, pageSize: 9999 });

      expect(res.body.data.length).toBeLessThanOrEqual(100);
    });

    test("should handle invalid page number gracefully", async () => {
      const res = await request(paginationApp)
        .get("/api/items-offset")
        .query({ page: 0, pageSize: 10 });

      // Should default to page 1 or handle gracefully
      expect(res.status).toBe(200);
    });

    test("should handle cursor at end of results", async () => {
      const res = await request(paginationApp)
        .get("/api/items-cursor")
        .query({ limit: 100, cursor: 99 });

      expect(res.body.data.length).toBeLessThanOrEqual(1);
      expect(res.body.pagination.hasMore).toBe(false);
    });
  });

  describe("Performance", () => {
    test("should handle pagination efficiently", async () => {
      const start = Date.now();

      for (let page = 1; page <= 5; page++) {
        await request(paginationApp)
          .get("/api/items-offset")
          .query({ page, pageSize: 20 });
      }

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(2000);
    });
  });

  describe("Pagination Discovery", () => {
    test("should reveal total count", async () => {
      const res = await request(paginationApp)
        .get("/api/items-offset")
        .query({ page: 1, pageSize: 10 });

      expect(res.body.pagination.total).toBe(100);
    });

    test("should reveal total pages", async () => {
      const res = await request(paginationApp)
        .get("/api/items-offset")
        .query({ page: 1, pageSize: 10 });

      expect(res.body.pagination.totalPages).toBe(10);
    });
  });
});
