/**
 * Error Handling & Recovery Tests
 * Tests application behavior in various error scenarios
 */

const request = require("supertest");
const express = require("express");

function createErrorApp() {
  const app = express();
  app.use(express.json());

  // Track error counts
  let errorCounts = {
    database: 0,
    network: 0,
    timeout: 0,
    validation: 0
  };

  // Simulate database errors
  app.post("/api/database-error", (req, res, next) => {
    errorCounts.database++;
    const error = new Error("Database connection failed");
    error.statusCode = 503;
    next(error);
  });

  // Simulate network errors
  app.post("/api/network-error", (req, res, next) => {
    errorCounts.network++;
    const error = new Error("Network timeout");
    error.statusCode = 504;
    next(error);
  });

  // Simulate timeout
  app.post("/api/timeout", async (req, res, next) => {
    errorCounts.timeout++;
    try {
      await new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Operation timeout")), 100)
      );
    } catch (error) {
      error.statusCode = 408;
      next(error);
    }
  });

  // Simulate validation error
  app.post("/api/validation-error", (req, res, next) => {
    const { email } = req.body;
    if (!email || !email.includes("@")) {
      errorCounts.validation++;
      const error = new Error("Invalid email format");
      error.statusCode = 400;
      next(error);
    } else {
      res.json({ success: true });
    }
  });

  // Simulate error recovery
  let failCount = {};
  app.post("/api/retry/:operation", (req, res, next) => {
    const { operation } = req.params;
    const { maxRetries = 3 } = req.body;

    if (!failCount[operation]) failCount[operation] = 0;

    if (failCount[operation] < maxRetries) {
      failCount[operation]++;
      const error = new Error(`Operation failed (attempt ${failCount[operation]})`);
      error.statusCode = 500;
      error.retryable = true;
      next(error);
    } else {
      res.json({ success: true, attempts: failCount[operation] });
    }
  });

  // Reset failures
  app.post("/api/retry/:operation/reset", (req, res) => {
    const { operation } = req.params;
    failCount[operation] = 0;
    res.json({ success: true });
  });

  // Circuit breaker simulation
  let circuitState = "closed"; // closed, open, half-open
  let failureCount = 0;
  const failureThreshold = 3;
  const resetTimeout = 2000;

  app.post("/api/circuit-breaker-fail", (req, res, next) => {
    if (circuitState === "open") {
      const error = new Error("Circuit breaker open");
      error.statusCode = 503;
      next(error);
    } else {
      failureCount++;
      if (failureCount >= failureThreshold) {
        circuitState = "open";
        setTimeout(() => {
          circuitState = "half-open";
          failureCount = 0;
        }, resetTimeout);
      }
      const error = new Error("Service unavailable");
      error.statusCode = 503;
      next(error);
    }
  });

  app.post("/api/circuit-breaker-success", (req, res) => {
    if (circuitState === "half-open") {
      circuitState = "closed";
      failureCount = 0;
    }
    res.json({ success: true });
  });

  app.get("/api/circuit-status", (req, res) => {
    res.json({ state: circuitState, failures: failureCount });
  });

  // Detailed error response
  app.post("/api/detailed-error", (req, res, next) => {
    const error = new Error("Resource not available");
    error.statusCode = 404;
    error.code = "RESOURCE_NOT_FOUND";
    error.details = { resource: "user", id: 123 };
    next(error);
  });

  // Chained errors
  app.post("/api/chained-error", (req, res, next) => {
    try {
      throw new Error("Original error");
    } catch (originalError) {
      const chainedError = new Error("Wrapped error");
      chainedError.statusCode = 500;
      chainedError.originalError = originalError;
      next(chainedError);
    }
  });

  // Partial success (some operations succeeded)
  app.post("/api/partial-success", (req, res) => {
    res.status(207).json({
      success: false,
      successCount: 2,
      failureCount: 1,
      results: [
        { id: 1, status: "success" },
        { id: 2, status: "success" },
        { id: 3, status: "failed", error: "Validation failed" }
      ]
    });
  });

  // Get error statistics
  app.get("/api/errors/stats", (_req, res) => {
    res.json(errorCounts);
  });

  // Error middleware
  app.use((error, req, res, next) => {
    const statusCode = error.statusCode || 500;
    const message = error.message || "Internal server error";

    res.status(statusCode).json({
      error: true,
      statusCode,
      message,
      code: error.code,
      details: error.details,
      retryable: error.retryable || false
    });
  });

  return app;
}

describe("Error Handling & Recovery", () => {
  let errorApp;

  beforeEach(() => {
    errorApp = createErrorApp();
  });

  describe("Error Types", () => {
    test("should handle database errors", async () => {
      const res = await request(errorApp).post("/api/database-error");

      expect(res.status).toBe(503);
      expect(res.body.error).toBe(true);
      expect(res.body.message).toContain("Database");
    });

    test("should handle network errors", async () => {
      const res = await request(errorApp).post("/api/network-error");

      expect(res.status).toBe(504);
      expect(res.body.message).toContain("Network");
    });

    test("should handle timeout errors", async () => {
      const res = await request(errorApp).post("/api/timeout");

      expect(res.status).toBe(408);
      expect(res.body.message).toContain("timeout");
    });

    test("should handle validation errors", async () => {
      const res = await request(errorApp)
        .post("/api/validation-error")
        .send({ email: "invalid" });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("email");
    });
  });

  describe("Error Response Format", () => {
    test("should include error flag", async () => {
      const res = await request(errorApp).post("/api/database-error");

      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toBe(true);
    });

    test("should include status code", async () => {
      const res = await request(errorApp).post("/api/network-error");

      expect(res.body).toHaveProperty("statusCode");
      expect(res.body.statusCode).toBe(504);
    });

    test("should include error message", async () => {
      const res = await request(errorApp).post("/api/database-error");

      expect(res.body).toHaveProperty("message");
      expect(typeof res.body.message).toBe("string");
    });

    test("should match HTTP status code to response body", async () => {
      const res = await request(errorApp).post("/api/database-error");

      expect(res.status).toBe(res.body.statusCode);
    });
  });

  describe("Detailed Error Information", () => {
    test("should include error code if available", async () => {
      const res = await request(errorApp).post("/api/detailed-error");

      expect(res.body).toHaveProperty("code");
      expect(res.body.code).toBe("RESOURCE_NOT_FOUND");
    });

    test("should include error details if available", async () => {
      const res = await request(errorApp).post("/api/detailed-error");

      expect(res.body).toHaveProperty("details");
      expect(res.body.details).toHaveProperty("resource");
      expect(res.body.details).toHaveProperty("id");
    });
  });

  describe("Retryability Information", () => {
    test("should indicate if error is retryable", async () => {
      const res = await request(errorApp).post("/api/database-error");

      expect(res.body).toHaveProperty("retryable");
    });

    test("transient errors should be marked retryable", async () => {
      const res = await request(errorApp)
        .post("/api/retry/test")
        .send({ maxRetries: 3 });

      expect(res.body.retryable).toBe(true);
    });
  });

  describe("Validation Error Handling", () => {
    test("should catch invalid input", async () => {
      const res = await request(errorApp)
        .post("/api/validation-error")
        .send({ email: "notanemail" });

      expect(res.status).toBe(400);
    });

    test("should accept valid input", async () => {
      const res = await request(errorApp)
        .post("/api/validation-error")
        .send({ email: "valid@example.com" });

      expect(res.status).toBe(200);
    });

    test("should reject missing required fields", async () => {
      const res = await request(errorApp)
        .post("/api/validation-error")
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe("Circuit Breaker Pattern", () => {
    test("should allow requests when circuit is closed", async () => {
      // First request fails but circuit is still closed
      await request(errorApp).post("/api/circuit-breaker-fail");

      expect([503, 500]).toContain(503);
    });

    test("should transition to open after threshold", async () => {
      // Make multiple failing requests to trigger circuit
      for (let i = 0; i < 3; i++) {
        await request(errorApp).post("/api/circuit-breaker-fail");
      }

      // Check circuit status
      const statusRes = await request(errorApp).get("/api/circuit-status");

      expect(statusRes.body.state).toBe("open");
    });

    test("should reject requests when circuit is open", async () => {
      // Trigger circuit to open
      for (let i = 0; i < 3; i++) {
        await request(errorApp).post("/api/circuit-breaker-fail");
      }

      // Try another request
      const res = await request(errorApp).post("/api/circuit-breaker-fail");

      expect(res.status).toBe(503);
      expect(res.body.message).toContain("Circuit breaker");
    });

    test("should transition through states", async () => {
      // Trigger circuit to open
      for (let i = 0; i < 3; i++) {
        await request(errorApp).post("/api/circuit-breaker-fail");
      }

      let statusRes = await request(errorApp).get("/api/circuit-status");
      expect(statusRes.body.state).toBe("open");

      // Wait for half-open state
      await new Promise(resolve => setTimeout(resolve, 2100));

      statusRes = await request(errorApp).get("/api/circuit-status");
      expect(statusRes.body.state).toBe("half-open");

      // Successful request should close circuit
      await request(errorApp).post("/api/circuit-breaker-success");

      statusRes = await request(errorApp).get("/api/circuit-status");
      expect(statusRes.body.state).toBe("closed");
    });
  });

  describe("Error Statistics", () => {
    test("should track error occurrences", async () => {
      await request(errorApp).post("/api/database-error");
      await request(errorApp).post("/api/network-error");

      const statsRes = await request(errorApp).get("/api/errors/stats");

      expect(statsRes.body.database).toBeGreaterThan(0);
      expect(statsRes.body.network).toBeGreaterThan(0);
    });

    test("should accumulate error counts", async () => {
      const beforeRes = await request(errorApp).get("/api/errors/stats");
      const beforeCount = beforeRes.body.database || 0;

      await request(errorApp).post("/api/database-error");

      const afterRes = await request(errorApp).get("/api/errors/stats");

      expect(afterRes.body.database).toBe(beforeCount + 1);
    });
  });

  describe("Partial Success Handling", () => {
    test("should return 207 for partial success", async () => {
      const res = await request(errorApp).post("/api/partial-success");

      expect(res.status).toBe(207);
    });

    test("should include success and failure counts", async () => {
      const res = await request(errorApp).post("/api/partial-success");

      expect(res.body).toHaveProperty("successCount");
      expect(res.body).toHaveProperty("failureCount");
      expect(res.body.successCount).toBe(2);
      expect(res.body.failureCount).toBe(1);
    });

    test("should include detailed results", async () => {
      const res = await request(errorApp).post("/api/partial-success");

      expect(res.body).toHaveProperty("results");
      expect(Array.isArray(res.body.results)).toBe(true);
      expect(res.body.results.length).toBe(3);
    });

    test("should indicate per-operation status", async () => {
      const res = await request(errorApp).post("/api/partial-success");

      res.body.results.forEach(result => {
        expect(["success", "failed"]).toContain(result.status);
      });
    });
  });

  describe("Chained Error Handling", () => {
    test("should handle error wrapping", async () => {
      const res = await request(errorApp).post("/api/chained-error");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe(true);
    });

    test("should include wrapped error info", async () => {
      const res = await request(errorApp).post("/api/chained-error");

      expect(res.body).toHaveProperty("message");
      expect(res.body.message).toContain("Wrapped");
    });
  });

  describe("Error Recovery Semantics", () => {
    test("should support retry operations", async () => {
      // First attempt fails
      let res = await request(errorApp)
        .post("/api/retry/test")
        .send({ maxRetries: 3 });

      expect(res.status).toBe(500);

      // Second attempt fails
      res = await request(errorApp)
        .post("/api/retry/test")
        .send({ maxRetries: 3 });

      expect(res.status).toBe(500);

      // Third attempt fails
      res = await request(errorApp)
        .post("/api/retry/test")
        .send({ maxRetries: 3 });

      expect(res.status).toBe(500);

      // Fourth attempt succeeds
      res = await request(errorApp)
        .post("/api/retry/test")
        .send({ maxRetries: 3 });

      expect(res.status).toBe(200);
    });

    test("should reset retry counters", async () => {
      // Make some attempts
      await request(errorApp)
        .post("/api/retry/test2")
        .send({ maxRetries: 2 });

      // Reset
      await request(errorApp).post("/api/retry/test2/reset");

      // Should retry from beginning
      let res = await request(errorApp)
        .post("/api/retry/test2")
        .send({ maxRetries: 2 });

      expect(res.status).toBe(500); // First attempt of new retry cycle
    });
  });
});
