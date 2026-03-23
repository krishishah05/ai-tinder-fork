/**
 * HTTP Protocol Compliance & Request/Response Handling Tests
 * Tests proper HTTP compliance and edge cases
 */

const request = require("supertest");
const express = require("express");

function createHttpApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Method handling
  app.get("/api/resource", (_req, res) => {
    res.json({ method: "GET" });
  });

  app.post("/api/resource", (_req, res) => {
    res.json({ method: "POST" });
  });

  app.put("/api/resource/:id", (req, res) => {
    res.json({ method: "PUT", id: req.params.id });
  });

  app.patch("/api/resource/:id", (req, res) => {
    res.json({ method: "PATCH", id: req.params.id });
  });

  app.delete("/api/resource/:id", (req, res) => {
    res.json({ method: "DELETE", id: req.params.id });
  });

  app.head("/api/resource", (_req, res) => {
    res.set("X-Resource-Count", "42");
    res.send();
  });

  app.options("/api/resource", (req, res) => {
    res.set("Allow", "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS");
    res.send();
  });

  // Status codes
  app.get("/api/status/200", (_req, res) => {
    res.status(200).json({ status: 200 });
  });

  app.post("/api/status/201", (_req, res) => {
    res.status(201).json({ id: 1 });
  });

  app.get("/api/status/204", (_req, res) => {
    res.status(204).send();
  });

  app.get("/api/status/301", (_req, res) => {
    res.redirect(301, "/api/status/200");
  });

  app.get("/api/status/302", (_req, res) => {
    res.redirect(302, "/api/status/200");
  });

  app.get("/api/status/304", (_req, res) => {
    res.status(304).set("ETag", '"12345"').send();
  });

  app.get("/api/status/400", (_req, res) => {
    res.status(400).json({ error: "Bad request" });
  });

  app.get("/api/status/401", (_req, res) => {
    res.status(401).json({ error: "Unauthorized" });
  });

  app.get("/api/status/403", (_req, res) => {
    res.status(403).json({ error: "Forbidden" });
  });

  app.get("/api/status/404", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.get("/api/status/429", (_req, res) => {
    res.status(429)
      .set("Retry-After", "60")
      .json({ error: "Too many requests" });
  });

  app.get("/api/status/500", (_req, res) => {
    res.status(500).json({ error: "Internal error" });
  });

  app.get("/api/status/503", (_req, res) => {
    res.status(503).json({ error: "Service unavailable" });
  });

  // Headers
  app.get("/api/headers", (req, res) => {
    res.json({
      received: req.headers
    });
  });

  app.post("/api/headers/echo", (req, res) => {
    res.set("X-Custom-Header", req.get("X-Request-ID") || "unknown");
    res.set("Content-Type", "application/json; charset=utf-8");
    res.json({ received: true });
  });

  // Query parameters
  app.get("/api/query", (req, res) => {
    res.json(req.query);
  });

  app.get("/api/query/required", (req, res) => {
    if (!req.query.id) {
      return res.status(400).json({ error: "Missing required query parameter: id" });
    }
    res.json({ id: req.query.id });
  });

  // Request body handling
  app.post("/api/body", (req, res) => {
    res.json({ received: req.body });
  });

  app.post("/api/body/empty", (req, res) => {
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ error: "Empty body not allowed" });
    }
    res.json({ received: req.body });
  });

  // Content type handling
  app.post("/api/content-type/json", (req, res) => {
    res.set("Content-Type", "application/json");
    res.json({ type: "json" });
  });

  app.post("/api/content-type/text", (req, res) => {
    res.set("Content-Type", "text/plain");
    res.send("text response");
  });

  app.post("/api/content-type/html", (req, res) => {
    res.set("Content-Type", "text/html");
    res.send("<html><body>HTML response</body></html>");
  });

  // Range requests
  app.get("/api/range", (req, res) => {
    const data = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    
    if (req.get("Range")) {
      res.status(206);
      res.set("Content-Range", `bytes 0-9/${data.length}`);
      res.send(data.slice(0, 10));
    } else {
      res.send(data);
    }
  });

  // Compression
  app.get("/api/compression", (_req, res) => {
    const largeData = new Array(1000).fill({ data: "large response" });
    res.json(largeData);
  });

  // Caching headers
  app.get("/api/cache/public", (_req, res) => {
    res.set("Cache-Control", "public, max-age=3600");
    res.json({ cached: true });
  });

  app.get("/api/cache/private", (_req, res) => {
    res.set("Cache-Control", "private, max-age=1800");
    res.json({ cached: false });
  });

  app.get("/api/cache/no-cache", (_req, res) => {
    res.set("Cache-Control", "no-cache");
    res.json({ cache: "validate" });
  });

  // ETag & Last-Modified
  app.get("/api/etag", (_req, res) => {
    const etag = '"abc123"';
    res.set("ETag", etag);
    if (req.get("If-None-Match") === etag) {
      res.status(304).send();
    } else {
      res.json({ data: "content" });
    }
  });

  // CORS headers
  app.get("/api/cors", (_req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE");
    res.json({ cors: "enabled" });
  });

  // Security headers
  app.get("/api/security", (_req, res) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("X-Frame-Options", "DENY");
    res.set("X-XSS-Protection", "1; mode=block");
    res.json({ secure: true });
  });

  // Streaming
  app.get("/api/stream", (_req, res) => {
    res.set("Content-Type", "application/json");
    res.json([
      { id: 1, data: "line1" },
      { id: 2, data: "line2" },
      { id: 3, data: "line3" }
    ]);
  });

  return app;
}

describe("HTTP Protocol Compliance", () => {
  let httpApp;

  beforeEach(() => {
    httpApp = createHttpApp();
  });

  describe("HTTP Methods", () => {
    test("should handle GET request", async () => {
      const res = await request(httpApp).get("/api/resource");

      expect(res.status).toBe(200);
      expect(res.body.method).toBe("GET");
    });

    test("should handle POST request", async () => {
      const res = await request(httpApp).post("/api/resource");

      expect(res.status).toBe(200);
      expect(res.body.method).toBe("POST");
    });

    test("should handle PUT request", async () => {
      const res = await request(httpApp).put("/api/resource/123");

      expect(res.status).toBe(200);
      expect(res.body.method).toBe("PUT");
    });

    test("should handle PATCH request", async () => {
      const res = await request(httpApp).patch("/api/resource/123");

      expect(res.status).toBe(200);
      expect(res.body.method).toBe("PATCH");
    });

    test("should handle DELETE request", async () => {
      const res = await request(httpApp).delete("/api/resource/123");

      expect(res.status).toBe(200);
      expect(res.body.method).toBe("DELETE");
    });

    test("should handle HEAD request", async () => {
      const res = await request(httpApp).head("/api/resource");

      expect(res.status).toBe(200);
      expect(res.get("X-Resource-Count")).toBe("42");
    });

    test("should handle OPTIONS request", async () => {
      const res = await request(httpApp).options("/api/resource");

      expect(res.status).toBe(200);
      expect(res.get("Allow")).toBeDefined();
    });
  });

  describe("Status Codes - Success", () => {
    test("should return 200 OK", async () => {
      const res = await request(httpApp).get("/api/status/200");

      expect(res.status).toBe(200);
    });

    test("should return 201 Created", async () => {
      const res = await request(httpApp).post("/api/status/201");

      expect(res.status).toBe(201);
    });

    test("should return 204 No Content", async () => {
      const res = await request(httpApp).get("/api/status/204");

      expect(res.status).toBe(204);
      expect(res.body).toEqual({});
    });
  });

  describe("Status Codes - Redirect", () => {
    test("should return 301 Moved Permanently", async () => {
      const res = await request(httpApp)
        .get("/api/status/301")
        .redirects(0);

      expect(res.status).toBe(301);
      expect(res.get("Location")).toBeDefined();
    });

    test("should return 302 Found", async () => {
      const res = await request(httpApp)
        .get("/api/status/302")
        .redirects(0);

      expect(res.status).toBe(302);
    });

    test("should return 304 Not Modified", async () => {
      const res = await request(httpApp).get("/api/status/304");

      expect(res.status).toBe(304);
    });
  });

  describe("Status Codes - Client Error", () => {
    test("should return 400 Bad Request", async () => {
      const res = await request(httpApp).get("/api/status/400");

      expect(res.status).toBe(400);
    });

    test("should return 401 Unauthorized", async () => {
      const res = await request(httpApp).get("/api/status/401");

      expect(res.status).toBe(401);
    });

    test("should return 403 Forbidden", async () => {
      const res = await request(httpApp).get("/api/status/403");

      expect(res.status).toBe(403);
    });

    test("should return 404 Not Found", async () => {
      const res = await request(httpApp).get("/api/status/404");

      expect(res.status).toBe(404);
    });

    test("should return 429 Too Many Requests", async () => {
      const res = await request(httpApp).get("/api/status/429");

      expect(res.status).toBe(429);
      expect(res.get("Retry-After")).toBe("60");
    });
  });

  describe("Status Codes - Server Error", () => {
    test("should return 500 Internal Server Error", async () => {
      const res = await request(httpApp).get("/api/status/500");

      expect(res.status).toBe(500);
    });

    test("should return 503 Service Unavailable", async () => {
      const res = await request(httpApp).get("/api/status/503");

      expect(res.status).toBe(503);
    });
  });

  describe("Request Headers", () => {
    test("should receive custom headers", async () => {
      const res = await request(httpApp)
        .get("/api/headers")
        .set("X-Custom-Header", "test-value");

      expect(res.body.received["x-custom-header"]).toBe("test-value");
    });

    test("should echo request ID in response header", async () => {
      const res = await request(httpApp)
        .post("/api/headers/echo")
        .set("X-Request-ID", "req-123");

      expect(res.get("X-Custom-Header")).toBe("req-123");
    });
  });

  describe("Response Headers", () => {
    test("should set Content-Type header", async () => {
      const res = await request(httpApp).post("/api/headers/echo");

      expect(res.get("Content-Type")).toContain("application/json");
    });

    test("should include charset in Content-Type", async () => {
      const res = await request(httpApp).post("/api/headers/echo");

      expect(res.get("Content-Type")).toContain("utf-8");
    });
  });

  describe("Query Parameters", () => {
    test("should parse query parameters", async () => {
      const res = await request(httpApp)
        .get("/api/query")
        .query({ search: "test", limit: "10" });

      expect(res.body.search).toBe("test");
      expect(res.body.limit).toBe("10");
    });

    test("should enforce required query parameters", async () => {
      const res = await request(httpApp).get("/api/query/required");

      expect(res.status).toBe(400);
    });

    test("should accept required query parameter", async () => {
      const res = await request(httpApp)
        .get("/api/query/required")
        .query({ id: "123" });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe("123");
    });
  });

  describe("Request Body", () => {
    test("should parse JSON body", async () => {
      const res = await request(httpApp)
        .post("/api/body")
        .send({ key: "value" });

      expect(res.body.received.key).toBe("value");
    });

    test("should handle multiple fields in body", async () => {
      const res = await request(httpApp)
        .post("/api/body")
        .send({ field1: "value1", field2: "value2", field3: 123 });

      expect(Object.keys(res.body.received).length).toBeGreaterThan(0);
    });

    test("should reject empty body when required", async () => {
      const res = await request(httpApp).post("/api/body/empty");

      expect(res.status).toBe(400);
    });
  });

  describe("Content Type Handling", () => {
    test("should respond with JSON content", async () => {
      const res = await request(httpApp).post("/api/content-type/json");

      expect(res.get("Content-Type")).toContain("application/json");
      expect(typeof res.body).toBe("object");
    });

    test("should respond with text content", async () => {
      const res = await request(httpApp).post("/api/content-type/text");

      expect(res.get("Content-Type")).toContain("text/plain");
      expect(typeof res.text).toBe("string");
    });

    test("should respond with HTML content", async () => {
      const res = await request(httpApp).post("/api/content-type/html");

      expect(res.get("Content-Type")).toContain("text/html");
    });
  });

  describe("Range Requests", () => {
    test("should support partial content retrieval", async () => {
      const res = await request(httpApp)
        .get("/api/range")
        .set("Range", "bytes=0-9");

      expect(res.status).toBe(206);
      expect(res.get("Content-Range")).toBeDefined();
    });

    test("should return full content without Range header", async () => {
      const res = await request(httpApp).get("/api/range");

      expect(res.status).toBe(200);
    });
  });

  describe("Caching", () => {
    test("should set cache control for public resources", async () => {
      const res = await request(httpApp).get("/api/cache/public");

      expect(res.get("Cache-Control")).toContain("public");
      expect(res.get("Cache-Control")).toContain("max-age");
    });

    test("should set cache control for private resources", async () => {
      const res = await request(httpApp).get("/api/cache/private");

      expect(res.get("Cache-Control")).toContain("private");
    });

    test("should disable cache when appropriate", async () => {
      const res = await request(httpApp).get("/api/cache/no-cache");

      expect(res.get("Cache-Control")).toContain("no-cache");
    });
  });

  describe("ETag & Conditional Requests", () => {
    test("should include ETag in response", async () => {
      const res = await request(httpApp).get("/api/etag");

      expect(res.get("ETag")).toBeDefined();
    });

    test("should return 304 if ETag matches", async () => {
      const firstRes = await request(httpApp).get("/api/etag");
      const etag = firstRes.get("ETag");

      const secondRes = await request(httpApp)
        .get("/api/etag")
        .set("If-None-Match", etag);

      expect(secondRes.status).toBe(304);
    });
  });

  describe("CORS", () => {
    test("should include CORS headers", async () => {
      const res = await request(httpApp).get("/api/cors");

      expect(res.get("Access-Control-Allow-Origin")).toBeDefined();
      expect(res.get("Access-Control-Allow-Methods")).toBeDefined();
    });
  });

  describe("Security Headers", () => {
    test("should include X-Content-Type-Options", async () => {
      const res = await request(httpApp).get("/api/security");

      expect(res.get("X-Content-Type-Options")).toBe("nosniff");
    });

    test("should include X-Frame-Options", async () => {
      const res = await request(httpApp).get("/api/security");

      expect(res.get("X-Frame-Options")).toBe("DENY");
    });

    test("should include X-XSS-Protection", async () => {
      const res = await request(httpApp).get("/api/security");

      expect(res.get("X-XSS-Protection")).toContain("1");
    });
  });

  describe("Streaming & Large Responses", () => {
    test("should handle streaming responses", async () => {
      const res = await request(httpApp).get("/api/stream");

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    test("should handle large compressed responses", async () => {
      const res = await request(httpApp).get("/api/compression");

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
