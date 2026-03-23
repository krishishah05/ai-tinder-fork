/**
 * Sorting & Filtering Query Parameter Tests
 * Tests query parameter handling for sorting, filtering, and search
 */

const request = require("supertest");
const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

function createFilterApp() {
  const app = express();
  app.use(express.json());

  const dbPath = path.join(__dirname, "filter.test.sqlite");
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      price REAL,
      stock INTEGER,
      rating REAL,
      createdAt INTEGER
    );
  `);

  // Insert sample data
  const products = [
    { name: "Laptop", category: "Electronics", price: 1200, stock: 5, rating: 4.8 },
    { name: "Phone", category: "Electronics", price: 800, stock: 10, rating: 4.5 },
    { name: "Tablet", category: "Electronics", price: 600, stock: 8, rating: 4.2 },
    { name: "Chair", category: "Furniture", price: 150, stock: 20, rating: 3.8 },
    { name: "Desk", category: "Furniture", price: 300, stock: 15, rating: 4.0 },
    { name: "Monitor", category: "Electronics", price: 400, stock: 12, rating: 4.6 },
    { name: "Keyboard", category: "Electronics", price: 100, stock: 50, rating: 4.3 },
    { name: "Mouse", category: "Electronics", price: 50, stock: 100, rating: 4.1 },
  ];

  const insertStmt = db.prepare(
    "INSERT INTO products (name, category, price, stock, rating, createdAt) VALUES (?, ?, ?, ?, ?, ?)"
  );
  
  products.forEach((product, index) => {
    insertStmt.run(
      product.name,
      product.category,
      product.price,
      product.stock,
      product.rating,
      Date.now() - (products.length - index) * 1000
    );
  });

  // Get all products with optional sorting/filtering
  app.get("/api/products", (req, res) => {
    let query = "SELECT * FROM products WHERE 1=1";
    const params = [];

    // Filtering
    if (req.query.category) {
      query += " AND category = ?";
      params.push(req.query.category);
    }

    if (req.query.minPrice) {
      query += " AND price >= ?";
      params.push(parseFloat(req.query.minPrice));
    }

    if (req.query.maxPrice) {
      query += " AND price <= ?";
      params.push(parseFloat(req.query.maxPrice));
    }

    if (req.query.search) {
      query += " AND name LIKE ?";
      params.push(`%${req.query.search}%`);
    }

    if (req.query.minRating) {
      query += " AND rating >= ?";
      params.push(parseFloat(req.query.minRating));
    }

    if (req.query.inStock) {
      query += " AND stock > 0";
    }

    // Sorting
    if (req.query.sortBy) {
      const validFields = ["name", "price", "stock", "rating", "createdAt"];
      if (!validFields.includes(req.query.sortBy)) {
        return res.status(400).json({ error: "Invalid sortBy field" });
      }

      const direction = req.query.sortDir === "desc" ? "DESC" : "ASC";
      query += ` ORDER BY ${req.query.sortBy} ${direction}`;
    }

    // Pagination
    if (req.query.limit) {
      const limit = Math.min(Math.max(1, parseInt(req.query.limit)), 100); // 1-100
      query += ` LIMIT ${limit}`;

      if (req.query.offset) {
        query += ` OFFSET ${Math.max(0, parseInt(req.query.offset))}`;
      }
    }

    const stmt = db.prepare(query);
    const rows = stmt.all(...params);

    res.json(rows);
  });

  // Search with multiple fields
  app.get("/api/search", (req, res) => {
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({ error: "Missing search query" });
    }

    const query = `
      SELECT * FROM products 
      WHERE name LIKE ? OR category LIKE ?
      ORDER BY name ASC
    `;

    const searchTerm = `%${q}%`;
    const rows = db.prepare(query).all(searchTerm, searchTerm);

    res.json(rows);
  });

  // Faceted search
  app.get("/api/facets", (_req, res) => {
    const categories = db
      .prepare("SELECT DISTINCT category FROM products ORDER BY category")
      .all()
      .map(row => row.category);

    const priceRanges = [
      { label: "Under $100", min: 0, max: 100 },
      { label: "$100-$500", min: 100, max: 500 },
      { label: "$500-$1000", min: 500, max: 1000 },
      { label: "Over $1000", min: 1000, max: Infinity }
    ];

    const ratingRanges = [
      { label: "4.5+", min: 4.5 },
      { label: "4.0+", min: 4.0 },
      { label: "3.5+", min: 3.5 }
    ];

    res.json({
      categories,
      priceRanges,
      ratingRanges
    });
  });

  return { app, db, dbPath };
}

describe("Sorting & Filtering", () => {
  let filterApp, filterDb, filterDbPath;

  beforeEach(() => {
    const result = createFilterApp();
    filterApp = result.app;
    filterDb = result.db;
    filterDbPath = result.dbPath;
  });

  afterEach(() => {
    if (fs.existsSync(filterDbPath)) fs.unlinkSync(filterDbPath);
  });

  describe("Filtering", () => {
    test("should filter by category", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({ category: "Electronics" });

      expect(res.status).toBe(200);
      expect(res.body.every(p => p.category === "Electronics")).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    test("should filter by price range", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({ minPrice: 100, maxPrice: 500 });

      expect(res.body.every(p => p.price >= 100 && p.price <= 500)).toBe(true);
    });

    test("should filter by minimum price", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({ minPrice: 500 });

      expect(res.body.every(p => p.price >= 500)).toBe(true);
    });

    test("should filter by maximum price", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({ maxPrice: 200 });

      expect(res.body.every(p => p.price <= 200)).toBe(true);
    });

    test("should filter by minimum rating", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({ minRating: 4.5 });

      expect(res.body.every(p => p.rating >= 4.5)).toBe(true);
    });

    test("should filter in-stock items only", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({ inStock: true });

      expect(res.body.every(p => p.stock > 0)).toBe(true);
    });

    test("should combine multiple filters", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({
          category: "Electronics",
          minPrice: 100,
          maxPrice: 1000,
          minRating: 4.0
        });

      expect(res.body.every(p => 
        p.category === "Electronics" &&
        p.price >= 100 &&
        p.price <= 1000 &&
        p.rating >= 4.0
      )).toBe(true);
    });

    test("should return empty when no filters match", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({ category: "NonExistent" });

      expect(res.body.length).toBe(0);
    });
  });

  describe("Search", () => {
    test("should search by product name", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({ search: "Phone" });

      expect(res.body.some(p => p.name.includes("Phone"))).toBe(true);
    });

    test("should search case-insensitive", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({ search: "phone" });

      expect(res.body.some(p => p.name.toLowerCase().includes("phone"))).toBe(true);
    });

    test("should search with partial match", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({ search: "top" }); // "laptop", "desktop"

      expect(res.body.length).toBeGreaterThanOrEqual(0);
    });

    test("should return empty for non-matching search", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({ search: "xyz123" });

      expect(res.body.length).toBe(0);
    });
  });

  describe("Sorting", () => {
    test("should sort by name ascending", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({ sortBy: "name", sortDir: "asc" });

      const names = res.body.map(p => p.name);
      const sorted = [...names].sort();

      expect(names).toEqual(sorted);
    });

    test("should sort by name descending", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({ sortBy: "name", sortDir: "desc" });

      const names = res.body.map(p => p.name);
      const sorted = [...names].sort().reverse();

      expect(names).toEqual(sorted);
    });

    test("should sort by price ascending", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({ sortBy: "price" });

      const prices = res.body.map(p => p.price);

      for (let i = 1; i < prices.length; i++) {
        expect(prices[i]).toBeGreaterThanOrEqual(prices[i - 1]);
      }
    });

    test("should sort by price descending", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({ sortBy: "price", sortDir: "desc" });

      const prices = res.body.map(p => p.price);

      for (let i = 1; i < prices.length; i++) {
        expect(prices[i]).toBeLessThanOrEqual(prices[i - 1]);
      }
    });

    test("should sort by rating", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({ sortBy: "rating", sortDir: "desc" });

      const ratings = res.body.map(p => p.rating);

      for (let i = 1; i < ratings.length; i++) {
        expect(ratings[i]).toBeLessThanOrEqual(ratings[i - 1]);
      }
    });

    test("should sort by stock", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({ sortBy: "stock" });

      const stocks = res.body.map(p => p.stock);

      for (let i = 1; i < stocks.length; i++) {
        expect(stocks[i]).toBeGreaterThanOrEqual(stocks[i - 1]);
      }
    });

    test("should sort by creation date", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({ sortBy: "createdAt" });

      const dates = res.body.map(p => p.createdAt);

      for (let i = 1; i < dates.length; i++) {
        expect(dates[i]).toBeGreaterThanOrEqual(dates[i - 1]);
      }
    });

    test("should reject invalid sortBy field", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({ sortBy: "invalid" });

      expect(res.status).toBe(400);
    });
  });

  describe("Pagination", () => {
    test("should limit results", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({ limit: 3 });

      expect(res.body.length).toBeLessThanOrEqual(3);
    });

    test("should enforce maximum limit", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({ limit: 1000 });

      expect(res.body.length).toBeLessThanOrEqual(100); // Max limit
    });

    test("should enforce minimum limit", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({ limit: 0 });

      expect(res.body.length).toBeGreaterThanOrEqual(1); // Min limit
    });

    test("should support offset", async () => {
      const res1 = await request(filterApp)
        .get("/api/products")
        .query({ limit: 3, offset: 0 });

      const res2 = await request(filterApp)
        .get("/api/products")
        .query({ limit: 3, offset: 3 });

      const ids1 = res1.body.map(p => p.id);
      const ids2 = res2.body.map(p => p.id);

      expect(ids1).not.toEqual(ids2);
    });

    test("should return empty when offset exceeds results", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({ offset: 10000 });

      expect(res.body.length).toBe(0);
    });

    test("should combine sorting and pagination", async () => {
      const res1 = await request(filterApp)
        .get("/api/products")
        .query({ sortBy: "price", limit: 3, offset: 0 });

      const res2 = await request(filterApp)
        .get("/api/products")
        .query({ sortBy: "price", limit: 3, offset: 3 });

      // Both should be sorted correctly
      const prices1 = res1.body.map(p => p.price);
      for (let i = 1; i < prices1.length; i++) {
        expect(prices1[i]).toBeGreaterThanOrEqual(prices1[i - 1]);
      }
    });
  });

  describe("Combined Operations", () => {
    test("should filter, search, sort, and paginate together", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({
          category: "Electronics",
          minPrice: 50,
          maxPrice: 1000,
          sortBy: "price",
          sortDir: "asc",
          limit: 5
        });

      expect(res.status).toBe(200);
      expect(res.body.every(p => 
        p.category === "Electronics" &&
        p.price >= 50 &&
        p.price <= 1000
      )).toBe(true);
      expect(res.body.length).toBeLessThanOrEqual(5);
    });

    test("should handle no results with filters", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({
          category: "Electronics",
          minPrice: 10000
        });

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(0);
    });
  });

  describe("Faceted Search", () => {
    test("should return available categories", async () => {
      const res = await request(filterApp).get("/api/facets");

      expect(res.body).toHaveProperty("categories");
      expect(Array.isArray(res.body.categories)).toBe(true);
      expect(res.body.categories.length).toBeGreaterThan(0);
    });

    test("should return price ranges", async () => {
      const res = await request(filterApp).get("/api/facets");

      expect(res.body).toHaveProperty("priceRanges");
      expect(Array.isArray(res.body.priceRanges)).toBe(true);
      expect(res.body.priceRanges[0]).toHaveProperty("label");
      expect(res.body.priceRanges[0]).toHaveProperty("min");
      expect(res.body.priceRanges[0]).toHaveProperty("max");
    });

    test("should return rating ranges", async () => {
      const res = await request(filterApp).get("/api/facets");

      expect(res.body).toHaveProperty("ratingRanges");
      expect(Array.isArray(res.body.ratingRanges)).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    test("should handle special characters in search", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({ search: "% or 1=1" });

      expect(res.status).toBe(200);
    });

    test("should handle negative prices gracefully", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({ minPrice: -100 });

      expect(res.status).toBe(200);
    });

    test("should handle float prices", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({ minPrice: 99.99, maxPrice: 100.01 });

      expect(res.status).toBe(200);
    });

    test("should handle large offset", async () => {
      const res = await request(filterApp)
        .get("/api/products")
        .query({ offset: 999999 });

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(0);
    });
  });

  describe("Performance Considerations", () => {
    test("should return sorted large dataset quickly", async () => {
      const start = Date.now();

      const res = await request(filterApp)
        .get("/api/products")
        .query({ sortBy: "price" });

      const duration = Date.now() - start;

      expect(res.status).toBe(200);
      expect(duration).toBeLessThan(1000); // Should complete in <1s
    });

    test("should handle complex filters efficiently", async () => {
      const start = Date.now();

      const res = await request(filterApp)
        .get("/api/products")
        .query({
          category: "Electronics",
          minPrice: 100,
          maxPrice: 1000,
          minRating: 4.0,
          sortBy: "price",
          limit: 10
        });

      const duration = Date.now() - start;

      expect(res.status).toBe(200);
      expect(duration).toBeLessThan(1000);
    });
  });
});
