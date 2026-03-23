/**
 * Boundary Conditions & Edge Case Tests
 * Tests behavior at limits and with unusual inputs
 */

const request = require("supertest");
const express = require("express");

function createBoundaryApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // String boundaries
  app.post("/api/strings", (req, res) => {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: "Missing text" });
    }

    if (text.length > 1000) {
      return res.status(400).json({ error: "Text too long" });
    }

    res.json({
      text,
      length: text.length,
      safe: true
    });
  });

  // Number boundaries
  app.post("/api/numbers", (req, res) => {
    const { value } = req.body;

    if (typeof value !== "number") {
      return res.status(400).json({ error: "Not a number" });
    }

    if (!isFinite(value)) {
      return res.status(400).json({ error: "Invalid number" });
    }

    if (value < 0 || value > 1000000) {
      return res.status(400).json({ error: "Out of range" });
    }

    res.json({ value, safe: true });
  });

  // Array boundaries
  app.post("/api/arrays", (req, res) => {
    const { items } = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: "Not an array" });
    }

    if (items.length === 0) {
      return res.status(400).json({ error: "Empty array" });
    }

    if (items.length > 10000) {
      return res.status(400).json({ error: "Array too large" });
    }

    res.json({
      count: items.length,
      first: items[0],
      last: items[items.length - 1]
    });
  });

  // Nested object boundaries
  app.post("/api/objects", (req, res) => {
    const { data } = req.body;

    if (!data || typeof data !== "object") {
      return res.status(400).json({ error: "Not an object" });
    }

    const depth = getDepth(data);
    if (depth > 10) {
      return res.status(400).json({ error: "Object too deeply nested" });
    }

    res.json({ depth, keys: Object.keys(data).length });
  });

  function getDepth(obj) {
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
      return 0;
    }
    const depths = Object.values(obj).map(getDepth);
    return depths.length ? Math.max(...depths) + 1 : 1;
  }

  // Unicode/emoji handling
  app.post("/api/unicode", (req, res) => {
    const { text } = req.body;

    res.json({
      text,
      length: text.length,
      byteLength: Buffer.byteLength(text, "utf8"),
      hasEmoji: /\p{Emoji}/u.test(text),
      normalized: text.normalize("NFC")
    });
  });

  // Whitespace handling
  app.post("/api/whitespace", (req, res) => {
    const { text } = req.body;

    res.json({
      original: text,
      trimmed: text.trim(),
      singleSpace: text.replace(/\s+/g, " ").trim(),
      length: text.length,
      trimmedLength: text.trim().length
    });
  });

  // Null/undefined handling
  app.post("/api/null-handling", (req, res) => {
    const { value } = req.body;

    res.json({
      received: value,
      isNull: value === null,
      isUndefined: value === undefined,
      isFalsy: !value,
      type: typeof value
    });
  });

  // Special numeric values
  app.post("/api/special-numbers", (req, res) => {
    const { value } = req.body;

    res.json({
      value,
      isNaN: isNaN(value),
      isInfinity: !isFinite(value),
      isPositiveInfinity: value === Infinity,
      isNegativeInfinity: value === -Infinity,
      isZero: value === 0,
      isNegativeZero: Object.is(value, -0)
    });
  });

  // Date boundaries
  app.post("/api/dates", (req, res) => {
    const { timestamp } = req.body;

    if (typeof timestamp !== "number") {
      return res.status(400).json({ error: "Not a timestamp" });
    }

    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      return res.status(400).json({ error: "Invalid date" });
    }

    res.json({
      timestamp,
      iso: date.toISOString(),
      isEpoch: timestamp === 0,
      isFuture: date > new Date(),
      isPast: date < new Date()
    });
  });

  // Circular reference detection (would cause issues if not handled)
  app.post("/api/circular", (req, res) => {
    try {
      const data = req.body;
      const json = JSON.stringify(data);
      res.json({ safe: true, stringified: true });
    } catch (error) {
      res.status(400).json({ error: "Circular reference detected" });
    }
  });

  // Very long response
  app.get("/api/large-response", (_req, res) => {
    const large = new Array(1000).fill(null).map((_, i) => ({
      id: i,
      data: "x".repeat(1000),
      nested: {
        field1: "value1",
        field2: "value2"
      }
    }));
    res.json(large);
  });

  // Empty/null responses
  app.get("/api/empty", (_req, res) => {
    res.json({});
  });

  app.get("/api/null", (_req, res) => {
    res.json(null);
  });

  app.get("/api/empty-array", (_req, res) => {
    res.json([]);
  });

  app.get("/api/empty-string", (_req, res) => {
    res.json({ value: "" });
  });

  // Timeout simulation
  app.get("/api/timeout-short", (_req, res) => {
    setTimeout(() => res.json({ timeout: 100 }), 100);
  });

  app.get("/api/timeout-long", (_req, res) => {
    setTimeout(() => res.json({ timeout: 30000 }), 30000);
  });

  return app;
}

describe("Boundary Conditions & Edge Cases", () => {
  let boundApp;

  beforeEach(() => {
    boundApp = createBoundaryApp();
  });

  describe("String Boundaries", () => {
    test("should accept single character", async () => {
      const res = await request(boundApp)
        .post("/api/strings")
        .send({ text: "a" });

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
    });

    test("should accept long string up to limit", async () => {
      const longText = "x".repeat(1000);
      const res = await request(boundApp)
        .post("/api/strings")
        .send({ text: longText });

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1000);
    });

    test("should reject string exceeding limit", async () => {
      const tooLong = "x".repeat(1001);
      const res = await request(boundApp)
        .post("/api/strings")
        .send({ text: tooLong });

      expect(res.status).toBe(400);
    });

    test("should handle empty string", async () => {
      const res = await request(boundApp)
        .post("/api/strings")
        .send({ text: "" });

      expect(res.status).toBe(400);
    });

    test("should handle whitespace-only string", async () => {
      const res = await request(boundApp)
        .post("/api/strings")
        .send({ text: "   " });

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(3);
    });

    test("should handle newlines in string", async () => {
      const res = await request(boundApp)
        .post("/api/strings")
        .send({ text: "line1\nline2\nline3" });

      expect(res.status).toBe(200);
    });

    test("should handle special characters", async () => {
      const res = await request(boundApp)
        .post("/api/strings")
        .send({ text: "!@#$%^&*()_+-=[]{}|;:',.<>?/" });

      expect(res.status).toBe(200);
    });
  });

  describe("Number Boundaries", () => {
    test("should accept zero", async () => {
      const res = await request(boundApp)
        .post("/api/numbers")
        .send({ value: 0 });

      expect(res.status).toBe(200);
    });

    test("should accept maximum value", async () => {
      const res = await request(boundApp)
        .post("/api/numbers")
        .send({ value: 1000000 });

      expect(res.status).toBe(200);
    });

    test("should reject negative numbers", async () => {
      const res = await request(boundApp)
        .post("/api/numbers")
        .send({ value: -1 });

      expect(res.status).toBe(400);
    });

    test("should reject numbers exceeding max", async () => {
      const res = await request(boundApp)
        .post("/api/numbers")
        .send({ value: 1000001 });

      expect(res.status).toBe(400);
    });

    test("should reject decimal numbers", async () => {
      const res = await request(boundApp)
        .post("/api/numbers")
        .send({ value: 3.14 });

      expect(res.status).toBe(400);
    });

    test("should reject Infinity", async () => {
      const res = await request(boundApp)
        .post("/api/numbers")
        .send({ value: Infinity });

      expect(res.status).toBe(400);
    });

    test("should reject NaN", async () => {
      const res = await request(boundApp)
        .post("/api/numbers")
        .send({ value: NaN });

      expect(res.status).toBe(400);
    });
  });

  describe("Array Boundaries", () => {
    test("should accept single-element array", async () => {
      const res = await request(boundApp)
        .post("/api/arrays")
        .send({ items: [1] });

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
    });

    test("should accept array with mixed types", async () => {
      const res = await request(boundApp)
        .post("/api/arrays")
        .send({ items: [1, "two", true, null] });

      expect(res.status).toBe(200);
    });

    test("should reject empty array", async () => {
      const res = await request(boundApp)
        .post("/api/arrays")
        .send({ items: [] });

      expect(res.status).toBe(400);
    });

    test("should reject array exceeding size limit", async () => {
      const huge = new Array(10001).fill(null);
      const res = await request(boundApp)
        .post("/api/arrays")
        .send({ items: huge });

      expect(res.status).toBe(400);
    });

    test("should handle array at size boundary", async () => {
      const maxArray = new Array(10000).fill(null).map((_, i) => i);
      const res = await request(boundApp)
        .post("/api/arrays")
        .send({ items: maxArray });

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(10000);
    });
  });

  describe("Object Nesting Boundaries", () => {
    test("should accept flat object", async () => {
      const res = await request(boundApp)
        .post("/api/objects")
        .send({
          data: {
            key1: "value1",
            key2: "value2"
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.depth).toBe(1);
    });

    test("should accept moderately nested object", async () => {
      const nested = {
        level1: {
          level2: {
            level3: {
              value: "deep"
            }
          }
        }
      };

      const res = await request(boundApp)
        .post("/api/objects")
        .send({ data: nested });

      expect(res.status).toBe(200);
    });

    test("should reject deeply nested object", async () => {
      let obj = { value: "deep" };
      for (let i = 0; i < 11; i++) {
        obj = { nested: obj };
      }

      const res = await request(boundApp)
        .post("/api/objects")
        .send({ data: obj });

      expect(res.status).toBe(400);
    });

    test("should handle object with many keys", async () => {
      const data = {};
      for (let i = 0; i < 100; i++) {
        data[`key${i}`] = `value${i}`;
      }

      const res = await request(boundApp)
        .post("/api/objects")
        .send({ data });

      expect(res.status).toBe(200);
      expect(res.body.keys).toBe(100);
    });
  });

  describe("Unicode & Emoji", () => {
    test("should handle ASCII text", async () => {
      const res = await request(boundApp)
        .post("/api/unicode")
        .send({ text: "Hello World" });

      expect(res.status).toBe(200);
    });

    test("should handle multi-byte UTF-8", async () => {
      const res = await request(boundApp)
        .post("/api/unicode")
        .send({ text: "你好世界🌍" });

      expect(res.status).toBe(200);
      expect(res.body.byteLength).toBeGreaterThan(res.body.length);
    });

    test("should handle emoji", async () => {
      const res = await request(boundApp)
        .post("/api/unicode")
        .send({ text: "🎉🎊🎈" });

      expect(res.status).toBe(200);
      expect(res.body.hasEmoji).toBe(true);
    });

    test("should normalize unicode", async () => {
      const res = await request(boundApp)
        .post("/api/unicode")
        .send({ text: "é" }); // Could be single char or e + accent

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("normalized");
    });
  });

  describe("Whitespace Handling", () => {
    test("should handle leading whitespace", async () => {
      const res = await request(boundApp)
        .post("/api/whitespace")
        .send({ text: "   text" });

      expect(res.body.trimmed).toBe("text");
    });

    test("should handle trailing whitespace", async () => {
      const res = await request(boundApp)
        .post("/api/whitespace")
        .send({ text: "text   " });

      expect(res.body.trimmed).toBe("text");
    });

    test("should handle multiple spaces between words", async () => {
      const res = await request(boundApp)
        .post("/api/whitespace")
        .send({ text: "word1    word2    word3" });

      expect(res.body.singleSpace).toBe("word1 word2 word3");
    });

    test("should handle tabs and newlines", async () => {
      const res = await request(boundApp)
        .post("/api/whitespace")
        .send({ text: "\t\ttab\t\ncode\n\n" });

      expect(res.status).toBe(200);
    });
  });

  describe("Null/Undefined Handling", () => {
    test("should handle null values", async () => {
      const res = await request(boundApp)
        .post("/api/null-handling")
        .send({ value: null });

      expect(res.body.isNull).toBe(true);
      expect(res.body.isFalsy).toBe(true);
    });

    test("should handle missing values", async () => {
      const res = await request(boundApp)
        .post("/api/null-handling")
        .send({});

      expect(res.body.isUndefined).toBe(true);
    });

    test("should handle false boolean", async () => {
      const res = await request(boundApp)
        .post("/api/null-handling")
        .send({ value: false });

      expect(res.body.isFalsy).toBe(true);
      expect(res.body.isNull).toBe(false);
    });

    test("should handle zero", async () => {
      const res = await request(boundApp)
        .post("/api/null-handling")
        .send({ value: 0 });

      expect(res.body.isFalsy).toBe(true);
      expect(res.body.type).toBe("number");
    });

    test("should handle empty string", async () => {
      const res = await request(boundApp)
        .post("/api/null-handling")
        .send({ value: "" });

      expect(res.body.isFalsy).toBe(true);
    });
  });

  describe("Special Numeric Values", () => {
    test("should identify NaN correctly", async () => {
      const res = await request(boundApp)
        .post("/api/special-numbers")
        .send({ value: NaN });

      expect(res.body.isNaN).toBe(true);
    });

    test("should identify positive Infinity", async () => {
      const res = await request(boundApp)
        .post("/api/special-numbers")
        .send({ value: Infinity });

      expect(res.body.isPositiveInfinity).toBe(true);
    });

    test("should identify negative Infinity", async () => {
      const res = await request(boundApp)
        .post("/api/special-numbers")
        .send({ value: -Infinity });

      expect(res.body.isNegativeInfinity).toBe(true);
    });

    test("should distinguish positive and negative zero", async () => {
      const res = await request(boundApp)
        .post("/api/special-numbers")
        .send({ value: -0 });

      expect(res.body.isNegativeZero).toBe(true);
      expect(res.body.isZero).toBe(true);
    });
  });

  describe("Date Boundaries", () => {
    test("should accept current timestamp", async () => {
      const res = await request(boundApp)
        .post("/api/dates")
        .send({ timestamp: Date.now() });

      expect(res.status).toBe(200);
    });

    test("should accept epoch time", async () => {
      const res = await request(boundApp)
        .post("/api/dates")
        .send({ timestamp: 0 });

      expect(res.status).toBe(200);
      expect(res.body.isEpoch).toBe(true);
    });

    test("should handle past dates", async () => {
      const pastTime = Date.now() - 86400000; // 1 day ago
      const res = await request(boundApp)
        .post("/api/dates")
        .send({ timestamp: pastTime });

      expect(res.body.isPast).toBe(true);
    });

    test("should handle future dates", async () => {
      const futureTime = Date.now() + 86400000; // 1 day from now
      const res = await request(boundApp)
        .post("/api/dates")
        .send({ timestamp: futureTime });

      expect(res.body.isFuture).toBe(true);
    });
  });

  describe("Response Edge Cases", () => {
    test("should handle empty object response", async () => {
      const res = await request(boundApp).get("/api/empty");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });

    test("should handle null response", async () => {
      const res = await request(boundApp).get("/api/null");

      expect(res.status).toBe(200);
      expect(res.body).toBeNull();
    });

    test("should handle empty array response", async () => {
      const res = await request(boundApp).get("/api/empty-array");

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });

    test("should handle empty string response", async () => {
      const res = await request(boundApp).get("/api/empty-string");

      expect(res.status).toBe(200);
      expect(res.body.value).toBe("");
    });
  });

  describe("Large Response Handling", () => {
    test("should handle large response", async () => {
      const res = await request(boundApp).get("/api/large-response");

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1000);
    });
  });

  describe("Timeouts", () => {
    test("should complete short timeout", async () => {
      const res = await request(boundApp)
        .get("/api/timeout-short")
        .timeout(500);

      expect(res.status).toBe(200);
    });

    test("should timeout on long operation", async () => {
      try {
        await request(boundApp)
          .get("/api/timeout-long")
          .timeout(100);

        fail("Should have timed out");
      } catch (error) {
        expect(error.code).toBe("ECONNABORTED");
      }
    });
  });
});
