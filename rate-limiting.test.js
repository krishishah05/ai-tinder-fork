/**
 * Rate Limiting & Request Throttling Tests
 * Tests rate limiting, throttling, and quota management
 */

const request = require("supertest");
const express = require("express");

function createRateLimitApp() {
  const app = express();
  app.use(express.json());

  // Simple rate limiter
  class RateLimiter {
    constructor(maxRequests = 10, windowMs = 60000) {
      this.maxRequests = maxRequests;
      this.windowMs = windowMs;
      this.requests = new Map();
    }

    isAllowed(clientId) {
      const now = Date.now();
      const key = clientId;

      if (!this.requests.has(key)) {
        this.requests.set(key, []);
      }

      const times = this.requests.get(key);

      // Remove old requests outside the window
      while (times.length > 0 && times[0] < now - this.windowMs) {
        times.shift();
      }

      if (times.length >= this.maxRequests) {
        return false;
      }

      times.push(now);
      return true;
    }

    getRemaining(clientId) {
      const key = clientId;
      const times = this.requests.get(key) || [];
      return Math.max(0, this.maxRequests - times.length);
    }

    getReset(clientId) {
      const key = clientId;
      const times = this.requests.get(key) || [];
      if (times.length === 0) return Date.now();
      return times[0] + this.windowMs;
    }

    reset(clientId) {
      if (clientId) {
        this.requests.delete(clientId);
      } else {
        this.requests.clear();
      }
    }
  }

  const limiter = new RateLimiter(5, 1000); // 5 requests per second

  const rateLimitMiddleware = (req, res, next) => {
    const clientId = req.get("X-Client-ID") || req.ip;

    if (!limiter.isAllowed(clientId)) {
      const resetTime = limiter.getReset(clientId);
      return res.status(429)
        .set("Retry-After", Math.ceil((resetTime - Date.now()) / 1000))
        .set("X-RateLimit-Limit", "5")
        .set("X-RateLimit-Remaining", "0")
        .set("X-RateLimit-Reset", resetTime)
        .json({
          error: "Too many requests",
          retryAfter: Math.ceil((resetTime - Date.now()) / 1000)
        });
    }

    res.set("X-RateLimit-Limit", "5");
    res.set("X-RateLimit-Remaining", limiter.getRemaining(clientId));
    res.set("X-RateLimit-Reset", limiter.getReset(clientId));

    next();
  };

  app.use(rateLimitMiddleware);

  app.get("/api/data", (_req, res) => {
    res.json({ data: "value" });
  });

  app.post("/api/submit", (req, res) => {
    res.json({ success: true });
  });

  // Endpoint to reset limits for testing
  app.post("/api/reset-limits", (req, res) => {
    const clientId = req.get("X-Client-ID") || req.ip;
    if (req.body.all) {
      limiter.reset();
    } else {
      limiter.reset(clientId);
    }
    res.json({ success: true });
  });

  // Different rate limits per endpoint
  class AdvancedLimiter {
    constructor() {
      this.limits = {
        "/api/expensive": { max: 2, window: 10000 },
        "/api/normal": { max: 20, window: 60000 },
        "/api/public": { max: 100, window: 60000 }
      };
      this.requests = new Map();
    }

    check(path, clientId) {
      const limit = this.limits[path];
      if (!limit) return true;

      const key = `${path}:${clientId}`;
      const now = Date.now();

      if (!this.requests.has(key)) {
        this.requests.set(key, []);
      }

      const times = this.requests.get(key);

      // Remove old requests
      while (times.length > 0 && times[0] < now - limit.window) {
        times.shift();
      }

      if (times.length >= limit.max) {
        return {
          allowed: false,
          remaining: 0,
          reset: times[0] + limit.window
        };
      }

      times.push(now);

      return {
        allowed: true,
        remaining: limit.max - times.length,
        reset: now + limit.window
      };
    }

    reset() {
      this.requests.clear();
    }
  }

  const advancedLimiter = new AdvancedLimiter();

  app.get("/api/expensive", (req, res) => {
    const clientId = req.get("X-Client-ID") || req.ip;
    const check = advancedLimiter.check("/api/expensive", clientId);

    if (!check.allowed) {
      return res.status(429)
        .set("Retry-After", Math.ceil((check.reset - Date.now()) / 1000))
        .json({ error: "Rate limit exceeded for expensive operation" });
    }

    res.json({ data: "expensive result" });
  });

  app.get("/api/normal", (req, res) => {
    const clientId = req.get("X-Client-ID") || req.ip;
    const check = advancedLimiter.check("/api/normal", clientId);

    if (!check.allowed) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }

    res.json({ data: "normal result" });
  });

  app.get("/api/public", (req, res) => {
    const clientId = req.get("X-Client-ID") || req.ip;
    const check = advancedLimiter.check("/api/public", clientId);

    if (!check.allowed) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }

    res.json({ data: "public result" });
  });

  app.post("/api/reset-advanced", (_req, res) => {
    advancedLimiter.reset();
    res.json({ success: true });
  });

  return app;
}

describe("Rate Limiting & Throttling", () => {
  let rateLimitApp;

  beforeEach(() => {
    rateLimitApp = createRateLimitApp();
  });

  describe("Basic Rate Limiting", () => {
    test("should allow requests within limit", async () => {
      for (let i = 0; i < 5; i++) {
        const res = await request(rateLimitApp)
          .get("/api/data")
          .set("X-Client-ID", "client1");

        expect(res.status).toBe(200);
      }
    });

    test("should reject request exceeding limit", async () => {
      // Use up the limit
      for (let i = 0; i < 5; i++) {
        await request(rateLimitApp)
          .get("/api/data")
          .set("X-Client-ID", "client2");
      }

      // Next request should fail
      const res = await request(rateLimitApp)
        .get("/api/data")
        .set("X-Client-ID", "client2");

      expect(res.status).toBe(429);
    });

    test("should return 429 Too Many Requests", async () => {
      for (let i = 0; i < 5; i++) {
        await request(rateLimitApp)
          .get("/api/data")
          .set("X-Client-ID", "client3");
      }

      const res = await request(rateLimitApp)
        .get("/api/data")
        .set("X-Client-ID", "client3");

      expect(res.status).toBe(429);
      expect(res.body.error).toBe("Too many requests");
    });
  });

  describe("Rate Limit Headers", () => {
    test("should include X-RateLimit-Limit header", async () => {
      const res = await request(rateLimitApp)
        .get("/api/data")
        .set("X-Client-ID", "client4");

      expect(res.get("X-RateLimit-Limit")).toBe("5");
    });

    test("should include X-RateLimit-Remaining header", async () => {
      const res = await request(rateLimitApp)
        .get("/api/data")
        .set("X-Client-ID", "client5");

      expect(res.get("X-RateLimit-Remaining")).toBeDefined();
      expect(Number(res.get("X-RateLimit-Remaining"))).toBeLessThanOrEqual(4);
    });

    test("should include X-RateLimit-Reset header", async () => {
      const res = await request(rateLimitApp)
        .get("/api/data")
        .set("X-Client-ID", "client6");

      expect(res.get("X-RateLimit-Reset")).toBeDefined();
    });

    test("should include Retry-After on 429", async () => {
      for (let i = 0; i < 5; i++) {
        await request(rateLimitApp)
          .get("/api/data")
          .set("X-Client-ID", "client7");
      }

      const res = await request(rateLimitApp)
        .get("/api/data")
        .set("X-Client-ID", "client7");

      expect(res.get("Retry-After")).toBeDefined();
      expect(Number(res.get("Retry-After"))).toBeGreaterThan(0);
    });

    test("should show zero remaining after limit", async () => {
      for (let i = 0; i < 5; i++) {
        await request(rateLimitApp)
          .get("/api/data")
          .set("X-Client-ID", "client8");
      }

      const res = await request(rateLimitApp)
        .get("/api/data")
        .set("X-Client-ID", "client8");

      expect(res.get("X-RateLimit-Remaining")).toBe("0");
    });
  });

  describe("Per-Client Rate Limiting", () => {
    test("should track limits separately per client", async () => {
      // Client A uses limit
      for (let i = 0; i < 5; i++) {
        await request(rateLimitApp)
          .get("/api/data")
          .set("X-Client-ID", "clientA");
      }

      // Client B should still have requests
      const res = await request(rateLimitApp)
        .get("/api/data")
        .set("X-Client-ID", "clientB");

      expect(res.status).toBe(200);
    });

    test("should reject one client but allow another", async () => {
      // Use up clientC's limit
      for (let i = 0; i < 5; i++) {
        await request(rateLimitApp)
          .get("/api/data")
          .set("X-Client-ID", "clientC");
      }

      const resC = await request(rateLimitApp)
        .get("/api/data")
        .set("X-Client-ID", "clientC");

      const resD = await request(rateLimitApp)
        .get("/api/data")
        .set("X-Client-ID", "clientD");

      expect(resC.status).toBe(429);
      expect(resD.status).toBe(200);
    });
  });

  describe("Rate Limit Reset", () => {
    test("should reset client limits", async () => {
      // Use up limit
      for (let i = 0; i < 5; i++) {
        await request(rateLimitApp)
          .get("/api/data")
          .set("X-Client-ID", "clientE");
      }

      // Reset
      await request(rateLimitApp)
        .post("/api/reset-limits")
        .set("X-Client-ID", "clientE");

      // Should be allowed again
      const res = await request(rateLimitApp)
        .get("/api/data")
        .set("X-Client-ID", "clientE");

      expect(res.status).toBe(200);
    });

    test("should reset all limits", async () => {
      // Use up multiple clients
      for (let i = 0; i < 5; i++) {
        await request(rateLimitApp)
          .get("/api/data")
          .set("X-Client-ID", "clientF");
      }

      // Reset all
      await request(rateLimitApp)
        .post("/api/reset-limits")
        .send({ all: true });

      // Should be allowed
      const res = await request(rateLimitApp)
        .get("/api/data")
        .set("X-Client-ID", "clientF");

      expect(res.status).toBe(200);
    });
  });

  describe("Time Window Behavior", () => {
    test("should allow request after time window expires", async (done) => {
      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        await request(rateLimitApp)
          .get("/api/data")
          .set("X-Client-ID", "clientG");
      }

      // Request rejected
      let res = await request(rateLimitApp)
        .get("/api/data")
        .set("X-Client-ID", "clientG");

      expect(res.status).toBe(429);

      // Wait for window to expire
      setTimeout(async () => {
        res = await request(rateLimitApp)
          .get("/api/data")
          .set("X-Client-ID", "clientG");

        expect(res.status).toBe(200);
        done();
      }, 1100);
    }, 10000);
  });

  describe("Endpoint-Specific Rate Limits", () => {
    test("should apply higher limit to public endpoint", async () => {
      const responses = [];

      for (let i = 0; i < 20; i++) {
        const res = await request(rateLimitApp)
          .get("/api/public")
          .set("X-Client-ID", "limit-test-public");

        responses.push(res.status);
      }

      // Should have at least 20 successful requests
      expect(responses.filter(s => s === 200).length).toBeGreaterThanOrEqual(20);
    });

    test("should apply lower limit to expensive endpoint", async () => {
      const responses = [];

      for (let i = 0; i < 5; i++) {
        const res = await request(rateLimitApp)
          .get("/api/expensive")
          .set("X-Client-ID", "limit-test-expensive");

        responses.push(res.status);
      }

      // Should have some 429 responses
      expect(responses.some(s => s === 429)).toBe(true);
    });

    test("should apply normal limit to standard endpoint", async () => {
      const responses = [];

      for (let i = 0; i < 10; i++) {
        const res = await request(rateLimitApp)
          .get("/api/normal")
          .set("X-Client-ID", "limit-test-normal");

        responses.push(res.status);
      }

      expect(responses.filter(s => s === 200).length).toBeGreaterThan(0);
    });
  });

  describe("Request Method Handling", () => {
    test("should count GET requests against limit", async () => {
      for (let i = 0; i < 5; i++) {
        await request(rateLimitApp)
          .get("/api/data")
          .set("X-Client-ID", "methodTest1");
      }

      const res = await request(rateLimitApp)
        .get("/api/data")
        .set("X-Client-ID", "methodTest1");

      expect(res.status).toBe(429);
    });

    test("should count POST requests against limit", async () => {
      for (let i = 0; i < 5; i++) {
        await request(rateLimitApp)
          .post("/api/submit")
          .set("X-Client-ID", "methodTest2");
      }

      const res = await request(rateLimitApp)
        .post("/api/submit")
        .set("X-Client-ID", "methodTest2");

      expect(res.status).toBe(429);
    });
  });

  describe("Edge Cases", () => {
    test("should handle requests with no client ID", async (done) => {
      const requests = [];

      for (let i = 0; i < 6; i++) {
        requests.push(request(rateLimitApp).get("/api/data"));
      }

      const responses = await Promise.all(requests);

      // Some may succeed and some may fail
      const statuses = responses.map(r => r.status);
      expect(statuses.some(s => s === 200)).toBe(true);

      done();
    });

    test("should handle very rapid requests", async () => {
      const requests = [];

      for (let i = 0; i < 10; i++) {
        requests.push(
          request(rateLimitApp)
            .get("/api/data")
            .set("X-Client-ID", "rapid")
        );
      }

      const responses = await Promise.all(requests);
      const statuses = responses.map(r => r.status);

      // Should have mix of 200 and 429
      expect(statuses.filter(s => s === 200).length).toBeLessThanOrEqual(5);
      expect(statuses.filter(s => s === 429).length).toBeGreaterThan(0);
    });

    test("should include retry information in error response", async () => {
      for (let i = 0; i < 5; i++) {
        await request(rateLimitApp)
          .get("/api/data")
          .set("X-Client-ID", "errorInfo");
      }

      const res = await request(rateLimitApp)
        .get("/api/data")
        .set("X-Client-ID", "errorInfo");

      expect(res.body).toHaveProperty("retryAfter");
      expect(res.body.retryAfter).toBeGreaterThan(0);
    });
  });

  describe("Rate Limit Information", () => {
    test("should show remaining requests decreasing", async () => {
      const remainings = [];

      for (let i = 0; i < 3; i++) {
        const res = await request(rateLimitApp)
          .get("/api/data")
          .set("X-Client-ID", "remainingTest");

        remainings.push(Number(res.get("X-RateLimit-Remaining")));
      }

      // Should be decreasing
      expect(remainings[1]).toBeLessThan(remainings[0]);
      expect(remainings[2]).toBeLessThan(remainings[1]);
    });

    test("should show accurate reset time", async () => {
      const res1 = await request(rateLimitApp)
        .get("/api/data")
        .set("X-Client-ID", "resetTest");

      const reset1 = Number(res1.get("X-RateLimit-Reset"));
      const now = Date.now();

      expect(reset1).toBeGreaterThan(now);
      expect(reset1).toBeLessThan(now + 2000); // Within 2 seconds
    });
  });
});
