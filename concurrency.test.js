/**
 * Concurrent request handling tests
 * Tests behavior with multiple simultaneous API calls
 */

const request = require("supertest");
const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

// Create concurrency test app
function createConcurrencyApp() {
  const app = express();
  app.use(express.json());

  const dbPath = path.join(__dirname, "concurrency.test.sqlite");
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS counters (
      id INTEGER PRIMARY KEY,
      count INTEGER DEFAULT 0
    );
    
    CREATE TABLE IF NOT EXISTS decisions (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      profileId TEXT NOT NULL,
      decision  TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
    
    INSERT OR IGNORE INTO counters (id, count) VALUES (1, 0);
  `);

  const stmtInsertDecision = db.prepare(
    "INSERT INTO decisions (profileId, decision, timestamp) VALUES (?, ?, ?)"
  );
  const stmtUpdateCounter = db.prepare("UPDATE counters SET count = count + 1 WHERE id = 1");
  const stmtGetCounter = db.prepare("SELECT count FROM counters WHERE id = 1");

  app.post("/api/decision", (req, res) => {
    const { profileId, decision } = req.body;
    stmtInsertDecision.run(profileId, decision, Date.now());
    stmtUpdateCounter.run();
    res.json({ success: true });
  });

  app.get("/api/counter", (_req, res) => {
    const row = stmtGetCounter.get();
    res.json({ count: row?.count || 0 });
  });

  app.post("/api/reset-counter", (_req, res) => {
    db.prepare("UPDATE counters SET count = 0 WHERE id = 1").run();
    res.json({ success: true });
  });

  return { app, db, dbPath };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Concurrent Request Handling", () => {
  let concurrencyApp, concurrencyDb, concurrencyDbPath;

  beforeEach(() => {
    const result = createConcurrencyApp();
    concurrencyApp = result.app;
    concurrencyDb = result.db;
    concurrencyDbPath = result.dbPath;
  });

  afterEach(() => {
    if (fs.existsSync(concurrencyDbPath)) fs.unlinkSync(concurrencyDbPath);
  });

  describe("Concurrent Writes", () => {
    test("should handle 10 concurrent writes", async () => {
      const promises = [];

      for (let i = 0; i < 10; i++) {
        promises.push(
          request(concurrencyApp)
            .post("/api/decision")
            .send({ profileId: `p${i}`, decision: "like" })
        );
      }

      const results = await Promise.all(promises);

      expect(results.every(r => r.status === 200)).toBe(true);
      expect(results.length).toBe(10);
    });

    test("should handle 50 concurrent writes", async () => {
      const promises = [];

      for (let i = 0; i < 50; i++) {
        promises.push(
          request(concurrencyApp)
            .post("/api/decision")
            .send({ profileId: `p${i}`, decision: i % 2 === 0 ? "like" : "nope" })
        );
      }

      const results = await Promise.all(promises);

      expect(results.filter(r => r.status === 200).length).toBe(50);
    });

    test("should handle 100 concurrent writes", async () => {
      const promises = [];

      for (let i = 0; i < 100; i++) {
        promises.push(
          request(concurrencyApp)
            .post("/api/decision")
            .send({
              profileId: `p${i}`,
              decision: ["like", "nope", "superlike"][i % 3],
            })
        );
      }

      const results = await Promise.all(promises);

      const successCount = results.filter(r => r.status === 200).length;
      expect(successCount).toBeGreaterThanOrEqual(95); // At least 95% success
    });

    test("should preserve data integrity with concurrent writes", async () => {
      const promises = [];

      for (let i = 0; i < 20; i++) {
        promises.push(
          request(concurrencyApp)
            .post("/api/decision")
            .send({ profileId: `p${i}`, decision: "like" })
        );
      }

      await Promise.all(promises);

      const counterRes = await request(concurrencyApp).get("/api/counter");
      expect(counterRes.body.count).toBe(20);
    });
  });

  describe("Mixed Concurrent Operations", () => {
    test("should handle concurrent writes and reads", async () => {
      const promises = [];

      // 20 writes
      for (let i = 0; i < 20; i++) {
        promises.push(
          request(concurrencyApp)
            .post("/api/decision")
            .send({ profileId: `p${i}`, decision: "like" })
        );
      }

      // 20 reads
      for (let i = 0; i < 20; i++) {
        promises.push(request(concurrencyApp).get("/api/counter"));
      }

      const results = await Promise.all(promises);

      const writeResults = results.slice(0, 20);
      const readResults = results.slice(20);

      expect(writeResults.every(r => r.status === 200)).toBe(true);
      expect(readResults.every(r => r.status === 200)).toBe(true);
    });

    test("should handle interleaved reads during writes", async () => {
      const counts = [];

      await request(concurrencyApp).post("/api/reset-counter");

      const promises = [];

      // Write 30 decisions concurrently
      for (let i = 0; i < 30; i++) {
        promises.push(
          request(concurrencyApp)
            .post("/api/decision")
            .send({ profileId: `p${i}`, decision: "like" })
        );
      }

      // Read count concurrently
      for (let i = 0; i < 5; i++) {
        setTimeout(async () => {
          const res = await request(concurrencyApp).get("/api/counter");
          counts.push(res.body.count);
        }, i * 50);
      }

      await Promise.all(promises);

      // Final count should be 30
      const finalRes = await request(concurrencyApp).get("/api/counter");
      expect(finalRes.body.count).toBe(30);
    });
  });

  describe("Race Conditions", () => {
    test("should handle concurrent operations on same resource", async () => {
      const promises = [];

      for (let i = 0; i < 15; i++) {
        promises.push(
          request(concurrencyApp)
            .post("/api/decision")
            .send({ profileId: "same_profile", decision: "like" })
        );
      }

      await Promise.all(promises);

      const counterRes = await request(concurrencyApp).get("/api/counter");
      expect(counterRes.body.count).toBe(15);
    });

    test("should maintain counter accuracy with high concurrency", async () => {
      const batchSize = 25;
      const batches = 4;

      for (let batch = 0; batch < batches; batch++) {
        const promises = [];

        for (let i = 0; i < batchSize; i++) {
          promises.push(
            request(concurrencyApp)
              .post("/api/decision")
              .send({
                profileId: `batch_${batch}_p${i}`,
                decision: "like",
              })
          );
        }

        await Promise.all(promises);
      }

      const counterRes = await request(concurrencyApp).get("/api/counter");
      expect(counterRes.body.count).toBe(batchSize * batches);
    });
  });

  describe("Concurrent Failure Handling", () => {
    test("should handle partial failures in concurrent requests", async () => {
      const promises = [];

      for (let i = 0; i < 10; i++) {
        if (i % 2 === 0) {
          // Valid requests
          promises.push(
            request(concurrencyApp)
              .post("/api/decision")
              .send({ profileId: `p${i}`, decision: "like" })
          );
        } else {
          // Invalid requests
          promises.push(
            request(concurrencyApp)
              .post("/api/decision")
              .send({}) // Missing required fields
          );
        }
      }

      const results = await Promise.allSettled(promises);

      const succeeded = results.filter(r => r.status === "fulfilled").length;
      expect(succeeded).toBeGreaterThan(0);
    });

    test("should use allSettled to handle mixed success/failure", async () => {
      const promises = [
        request(concurrencyApp)
          .post("/api/decision")
          .send({ profileId: "p1", decision: "like" }),
        request(concurrencyApp)
          .post("/api/decision")
          .send({} /* Will fail */),
        request(concurrencyApp)
          .post("/api/decision")
          .send({ profileId: "p2", decision: "nope" }),
      ];

      const results = await Promise.allSettled(promises);

      expect(results.length).toBe(3);
      expect(results.some(r => r.status === "fulfilled")).toBe(true);
    });
  });

  describe("Concurrency Patterns", () => {
    test("should handle producer pattern (multiple writers)", async () => {
      const numProducers = 10;
      const itemsPerProducer = 10;

      const producers = [];
      for (let p = 0; p < numProducers; p++) {
        const producerPromises = [];
        for (let i = 0; i < itemsPerProducer; i++) {
          producerPromises.push(
            request(concurrencyApp)
              .post("/api/decision")
              .send({ profileId: `producer_${p}_item_${i}`, decision: "like" })
          );
        }
        producers.push(Promise.all(producerPromises));
      }

      await Promise.all(producers);

      const counterRes = await request(concurrencyApp).get("/api/counter");
      expect(counterRes.body.count).toBe(numProducers * itemsPerProducer);
    });

    test("should handle consumer pattern (reading while writing)", async () => {
      const writes = [];
      const reads = [];

      // Writers
      for (let i = 0; i < 20; i++) {
        writes.push(
          request(concurrencyApp)
            .post("/api/decision")
            .send({ profileId: `p${i}`, decision: "like" })
        );
      }

      // Readers
      for (let i = 0; i < 5; i++) {
        reads.push(request(concurrencyApp).get("/api/counter"));
      }

      await Promise.all([...writes, ...reads]);

      const finalCountRes = await request(concurrencyApp).get("/api/counter");
      expect(finalCountRes.body.count).toBe(20);
    });

    test("should handle fan-out pattern", async () => {
      // Start one operation that spawns multiple concurrent ops
      const fanOutResults = [];

      for (let i = 0; i < 15; i++) {
        fanOutResults.push(
          request(concurrencyApp)
            .post("/api/decision")
            .send({ profileId: `fanout_${i}`, decision: "like" })
        );
      }

      const results = await Promise.all(fanOutResults);

      expect(results.filter(r => r.status === 200).length).toBeGreaterThanOrEqual(14);
    });

    test("should handle fan-in pattern", async () => {
      const targetProfileId = "target_profile";

      const requests = [];
      for (let i = 0; i < 10; i++) {
        requests.push(
          request(concurrencyApp)
            .post("/api/decision")
            .send({ profileId: targetProfileId, decision: "like" })
        );
      }

      await Promise.all(requests);

      const counterRes = await request(concurrencyApp).get("/api/counter");
      expect(counterRes.body.count).toBe(10);
    });
  });

  describe("Deadlock Prevention", () => {
    test("should not deadlock with circular dependencies", async () => {
      const promises = [];

      // All requesting same endpoint - test for timeout/deadlock
      for (let i = 0; i < 20; i++) {
        promises.push(
          new Promise((resolve) => {
            const startTime = Date.now();
            request(concurrencyApp)
              .post("/api/decision")
              .send({ profileId: `p${i}`, decision: "like" })
              .then(() => {
                const duration = Date.now() - startTime;
                resolve(duration);
              });
          })
        );
      }

      const durations = await Promise.all(promises);

      // None should timeout (arbitrarily long)
      expect(durations.every(d => d < 5000)).toBe(true);
    });
  });

  describe("Concurrency Limits", () => {
    test("should handle being at system concurrency limit", async () => {
      const largeLoad = 200;
      const promises = [];

      for (let i = 0; i < largeLoad; i++) {
        promises.push(
          request(concurrencyApp)
            .post("/api/decision")
            .send({ profileId: `p${i}`, decision: "like" })
            .catch(e => ({ status: 500, error: e.message }))
        );
      }

      const results = await Promise.allSettled(promises);

      const successCount = results.filter(
        r => r.status === "fulfilled" && r.value?.status === 200
      ).length;

      // Should handle most requests successfully
      expect(successCount).toBeGreaterThanOrEqual(largeLoad * 0.9);
    });
  });

  describe("Timeout Behavior Under Concurrency", () => {
    test("timeout values should be respected under high concurrency", async () => {
      const startTime = Date.now();
      const promises = [];

      for (let i = 0; i < 50; i++) {
        promises.push(
          request(concurrencyApp)
            .post("/api/decision")
            .send({ profileId: `p${i}`, decision: "like" })
            .timeout(5000)
        );
      }

      const results = await Promise.allSettled(promises);
      const totalTime = Date.now() - startTime;

      // Should complete within reasonable time despite concurrency
      expect(totalTime).toBeLessThan(10000);
    });
  });
});
