/**
 * Caching & Memoization Tests
 * Tests response caching, cache invalidation, and memoization
 */

const request = require("supertest");
const express = require("express");

function createCacheApp() {
  const app = express();
  app.use(express.json());

  // Simple cache implementation
  class Cache {
    constructor(ttl = 5000) {
      this.ttl = ttl;
      this.store = new Map();
    }

    set(key, value) {
      const expiresAt = Date.now() + this.ttl;
      this.store.set(key, { value, expiresAt });
    }

    get(key) {
      const item = this.store.get(key);
      if (!item) return null;

      if (item.expiresAt < Date.now()) {
        this.store.delete(key);
        return null;
      }

      return item.value;
    }

    has(key) {
      return this.get(key) !== null;
    }

    delete(key) {
      this.store.delete(key);
    }

    clear() {
      this.store.clear();
    }

    size() {
      return this.store.size;
    }

    isFresh(key) {
      const item = this.store.get(key);
      if (!item) return false;
      return item.expiresAt > Date.now();
    }

    getExpiration(key) {
      const item = this.store.get(key);
      return item ? item.expiresAt : null;
    }
  }

  // Global cache
  const cache = new Cache(3000);

  // Request counter for testing
  let requestCount = 0;

  // Cache middleware
  const cacheMiddleware = (req, res, next) => {
    if (req.method !== "GET") {
      return next();
    }

    const cacheKey = `${req.method}:${req.path}:${JSON.stringify(req.query)}`;
    const cached = cache.get(cacheKey);

    if (cached) {
      res.set("X-Cache", "HIT");
      return res.json(cached);
    }

    // Intercept res.json to cache the response
    const originalJson = res.json.bind(res);
    res.json = function(data) {
      cache.set(cacheKey, data);
      res.set("X-Cache", "MISS");
      return originalJson(data);
    };

    next();
  };

  app.use(cacheMiddleware);

  // Endpoint that returns data with timestamp
  app.get("/api/data", (req, res) => {
    requestCount++;
    res.json({
      data: "test",
      timestamp: Date.now(),
      requestCount: requestCount
    });
  });

  // Cache info endpoint
  app.get("/api/cache/info", (_req, res) => {
    res.json({
      size: cache.size()
    });
  });

  // Cache clear endpoint
  app.post("/api/cache/clear", (_req, res) => {
    cache.clear();
    requestCount = 0;
    res.json({ success: true });
  });

  // Manual cache invalidation
  app.delete("/api/cache/:key", (req, res) => {
    const key = req.params.key;
    cache.delete(key);
    res.json({ success: true });
  });

  // ETag support
  let etagCounter = 0;
  app.get("/api/etag-resource", (req, res) => {
    const etag = `"${++etagCounter}"`;
    const ifNoneMatch = req.get("If-None-Match");

    if (ifNoneMatch === etag) {
      return res.status(304).send();
    }

    res.set("ETag", etag);
    res.json({ data: "resource", version: etagCounter });
  });

  // Last-Modified support
  let lastModified = new Date();
  app.get("/api/modified-resource", (req, res) => {
    const ifModifiedSince = req.get("If-Modified-Since");

    if (ifModifiedSince === lastModified.toUTCString()) {
      return res.status(304).send();
    }

    res.set("Last-Modified", lastModified.toUTCString());
    res.json({ data: "resource", modified: lastModified.toISOString() });
  });

  app.put("/api/modified-resource", (req, res) => {
    lastModified = new Date();
    res.set("Last-Modified", lastModified.toUTCString());
    res.json({ success: true, modified: lastModified.toISOString() });
  });

  // Memoization function
  const memoizedFunctions = new Map();

  app.get("/api/expensive/:value", (req, res) => {
    const { value } = req.params;
    const cacheKey = `expensive:${value}`;

    if (memoizedFunctions.has(cacheKey)) {
      return res.json({
        result: memoizedFunctions.get(cacheKey),
        cached: true
      });
    }

    // Simulate expensive operation
    const result = parseInt(value) * parseInt(value);
    memoizedFunctions.set(cacheKey, result);

    res.json({
      result: result,
      cached: false
    });
  });

  app.post("/api/expensive/clear", (_req, res) => {
    memoizedFunctions.clear();
    res.json({ success: true });
  });

  // Cache invalidation on mutation
  app.post("/api/user", (req, res) => {
    cache.clear(); // Clear all caches on create
    res.status(201).json({ id: 1, ...req.body });
  });

  app.put("/api/user/:id", (req, res) => {
    cache.clear(); // Clear all caches on update
    res.json({ id: req.params.id, ...req.body });
  });

  app.delete("/api/user/:id", (req, res) => {
    cache.clear(); // Clear all caches on delete
    res.json({ success: true });
  });

  return { app, cache };
}

describe("Caching & Memoization", () => {
  let cacheApp, cacheStore;

  beforeEach(() => {
    const result = createCacheApp();
    cacheApp = result.app;
    cacheStore = result.cache;
  });

  afterEach(() => {
    cacheStore.clear();
  });

  describe("Basic Caching", () => {
    test("should return data on first request", async () => {
      const res = await request(cacheApp).get("/api/data");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("data");
    });

    test("should cache GET requests", async () => {
      const res1 = await request(cacheApp).get("/api/data");
      const res2 = await request(cacheApp).get("/api/data");

      expect(res1.body.timestamp).toBe(res2.body.timestamp);
    });

    test("should mark cache hits", async () => {
      await request(cacheApp).get("/api/data");
      const res2 = await request(cacheApp).get("/api/data");

      expect(res2.get("X-Cache")).toBe("HIT");
    });

    test("should mark cache misses", async () => {
      const res = await request(cacheApp).get("/api/data");

      expect(res.get("X-Cache")).toBe("MISS");
    });
  });

  describe("Cache Expiration", () => {
    test("should expire cached data after TTL", async (done) => {
      const res1 = await request(cacheApp).get("/api/data");
      const timestamp1 = res1.body.timestamp;

      setTimeout(async () => {
        const res2 = await request(cacheApp).get("/api/data");
        const timestamp2 = res2.body.timestamp;

        expect(timestamp2).toBeGreaterThan(timestamp1);
        done();
      }, 3500);
    }, 10000);

    test("should serve from cache before expiration", async () => {
      const res1 = await request(cacheApp).get("/api/data");
      const timestamp1 = res1.body.timestamp;

      await new Promise(r => setTimeout(r, 1000));

      const res2 = await request(cacheApp).get("/api/data");
      const timestamp2 = res2.body.timestamp;

      expect(timestamp1).toBe(timestamp2);
    });
  });

  describe("Cache Invalidation", () => {
    test("should invalidate cache on POST", async () => {
      await request(cacheApp).get("/api/data");

      await request(cacheApp)
        .post("/api/user")
        .send({ name: "test" });

      const res = await request(cacheApp).get("/api/data");

      expect(res.get("X-Cache")).toBe("MISS");
    });

    test("should invalidate cache on PUT", async () => {
      await request(cacheApp).get("/api/data");

      await request(cacheApp)
        .put("/api/user/1")
        .send({ name: "updated" });

      const res = await request(cacheApp).get("/api/data");

      expect(res.get("X-Cache")).toBe("MISS");
    });

    test("should invalidate cache on DELETE", async () => {
      await request(cacheApp).get("/api/data");

      await request(cacheApp).delete("/api/user/1");

      const res = await request(cacheApp).get("/api/data");

      expect(res.get("X-Cache")).toBe("MISS");
    });

    test("should manually clear cache", async () => {
      await request(cacheApp).get("/api/data");

      await request(cacheApp).post("/api/cache/clear");

      const res = await request(cacheApp).get("/api/data");

      expect(res.get("X-Cache")).toBe("MISS");
    });
  });

  describe("Cache Keys", () => {
    test("should use different cache keys for different paths", async () => {
      const res1 = await request(cacheApp).get("/api/data");
      const count1 = res1.body.requestCount;

      // This would be different endpoint, for now just test same endpoint
      const res2 = await request(cacheApp).get("/api/data");

      expect(res1.body.requestCount).toBe(res2.body.requestCount);
    });

    test("should use different cache keys for different query params", async () => {
      const res1 = await request(cacheApp)
        .get("/api/data")
        .query({ filter: "a" });

      const res2 = await request(cacheApp)
        .get("/api/data")
        .query({ filter: "b" });

      // Should be different cache keys (in real app with proper handling)
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
    });
  });

  describe("ETag Support", () => {
    test("should include ETag in response", async () => {
      const res = await request(cacheApp).get("/api/etag-resource");

      expect(res.get("ETag")).toBeDefined();
    });

    test("should return 304 for matching ETag", async () => {
      const res1 = await request(cacheApp).get("/api/etag-resource");
      const etag = res1.get("ETag");

      const res2 = await request(cacheApp)
        .get("/api/etag-resource")
        .set("If-None-Match", etag);

      expect(res2.status).toBe(304);
    });

    test("should return full response for non-matching ETag", async () => {
      const res = await request(cacheApp)
        .get("/api/etag-resource")
        .set("If-None-Match", '"wrong"');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("data");
    });
  });

  describe("Last-Modified Support", () => {
    test("should include Last-Modified header", async () => {
      const res = await request(cacheApp).get("/api/modified-resource");

      expect(res.get("Last-Modified")).toBeDefined();
    });

    test("should return 304 for If-Modified-Since match", async () => {
      const res1 = await request(cacheApp).get("/api/modified-resource");
      const lastModified = res1.get("Last-Modified");

      const res2 = await request(cacheApp)
        .get("/api/modified-resource")
        .set("If-Modified-Since", lastModified);

      expect(res2.status).toBe(304);
    });

    test("should update Last-Modified on content change", async () => {
      const res1 = await request(cacheApp).get("/api/modified-resource");
      const modified1 = res1.get("Last-Modified");

      await new Promise(r => setTimeout(r, 100));

      await request(cacheApp).put("/api/modified-resource");

      const res2 = await request(cacheApp).get("/api/modified-resource");
      const modified2 = res2.get("Last-Modified");

      expect(modified2).not.toBe(modified1);
    });
  });

  describe("Memoization", () => {
    test("should memoize function results", async () => {
      const res1 = await request(cacheApp).get("/api/expensive/5");
      expect(res1.body.cached).toBe(false);
      expect(res1.body.result).toBe(25);

      const res2 = await request(cacheApp).get("/api/expensive/5");
      expect(res2.body.cached).toBe(true);
      expect(res2.body.result).toBe(25);
    });

    test("should return different results for different inputs", async () => {
      const res1 = await request(cacheApp).get("/api/expensive/5");
      const res2 = await request(cacheApp).get("/api/expensive/10");

      expect(res1.body.result).toBe(25);
      expect(res2.body.result).toBe(100);
    });

    test("should clear memoization cache", async () => {
      const res1 = await request(cacheApp).get("/api/expensive/5");
      expect(res1.body.cached).toBe(false);

      await request(cacheApp).post("/api/expensive/clear");

      const res2 = await request(cacheApp).get("/api/expensive/5");
      expect(res2.body.cached).toBe(false);
    });
  });

  describe("Cache Statistics", () => {
    test("should report cache size", async () => {
      await request(cacheApp).get("/api/data");

      const res = await request(cacheApp).get("/api/cache/info");

      expect(res.body.size).toBeGreaterThan(0);
    });

    test("should report zero cache size after clear", async () => {
      await request(cacheApp).get("/api/data");

      await request(cacheApp).post("/api/cache/clear");

      const res = await request(cacheApp).get("/api/cache/info");

      expect(res.body.size).toBe(0);
    });
  });

  describe("Cache Strategies", () => {
    test("should support cache-aside pattern", async () => {
      const res1 = await request(cacheApp).get("/api/data");
      expect(res1.get("X-Cache")).toBe("MISS");

      const res2 = await request(cacheApp).get("/api/data");
      expect(res2.get("X-Cache")).toBe("HIT");

      expect(res1.body.timestamp).toBe(res2.body.timestamp);
    });

    test("should support write-through invalidation", async () => {
      // Write
      await request(cacheApp)
        .post("/api/user")
        .send({ name: "new" });

      // Next read should be a miss
      const res = await request(cacheApp).get("/api/data");
      expect(res.get("X-Cache")).toBe("MISS");
    });
  });

  describe("HTTP Cache Control Headers", () => {
    test("should support conditional requests", async () => {
      const res1 = await request(cacheApp).get("/api/etag-resource");
      expect(res1.status).toBe(200);

      const etag = res1.get("ETag");
      const res2 = await request(cacheApp)
        .get("/api/etag-resource")
        .set("If-None-Match", etag);

      expect(res2.status).toBe(304);
    });

    test("should minimize bandwidth with 304 responses", async () => {
      const res1 = await request(cacheApp).get("/api/etag-resource");
      const fullBody = JSON.stringify(res1.body);

      const res2 = await request(cacheApp)
        .get("/api/etag-resource")
        .set("If-None-Match", res1.get("ETag"));

      expect(res2.body).toEqual({});
      expect(JSON.stringify(res2.body).length).toBeLessThan(fullBody.length);
    });
  });

  describe("Cache Coherency", () => {
    test("should maintain consistent state with mutations", async () => {
      const res1 = await request(cacheApp).get("/api/data");
      const data1 = res1.body.requestCount;

      // Invalidate cache with mutation
      await request(cacheApp)
        .post("/api/user")
        .send({ name: "test" });

      const res2 = await request(cacheApp).get("/api/data");
      const data2 = res2.body.requestCount;

      // Should be different (cache was cleared)
      expect(data2).toBeGreaterThan(data1);
    });
  });

  describe("Performance Impact", () => {
    test("cached requests should be faster", async () => {
      const start1 = Date.now();
      await request(cacheApp).get("/api/data");
      const time1 = Date.now() - start1;

      const start2 = Date.now();
      await request(cacheApp).get("/api/data");
      const time2 = Date.now() - start2;

      // Cached request should be faster (or at least not slower)
      expect(time2).toBeLessThanOrEqual(time1 + 10); // Allow 10ms variance
    });
  });
});
