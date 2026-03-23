/**
 * Performance and load testing
 * Tests response times, throughput, and behavior under load
 */

const request = require("supertest");
const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

// Create performance test app
function createPerfTestApp() {
  const app = express();
  app.use(express.json());

  const dbPath = path.join(__dirname, "perf.test.sqlite");
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS decisions (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      profileId TEXT NOT NULL,
      decision  TEXT NOT NULL,
      profile   TEXT,
      matched   INTEGER DEFAULT 0,
      timestamp INTEGER NOT NULL
    );
  `);

  const stmtInsertDecision = db.prepare(
    "INSERT INTO decisions (profileId, decision, profile, matched, timestamp) VALUES (?, ?, ?, ?, ?)"
  );

  app.post("/api/decision", (req, res) => {
    const { profileId, decision } = req.body;
    stmtInsertDecision.run(profileId, decision, null, 0, Date.now());
    res.json({ success: true, decision });
  });

  app.get("/api/decisions", (_req, res) => {
    const rows = db.prepare("SELECT * FROM decisions ORDER BY timestamp DESC").all();
    res.json(rows);
  });

  return { app, db, dbPath };
}

// Performance measurement utilities
class PerformanceMonitor {
  constructor() {
    this.measurements = [];
    this.startTime = null;
  }

  startMeasurement() {
    this.startTime = Date.now();
  }

  endMeasurement(label) {
    const duration = Date.now() - this.startTime;
    this.measurements.push({ label, duration });
    return duration;
  }

  getStats() {
    if (this.measurements.length === 0) return null;

    const durations = this.measurements.map(m => m.duration);
    const total = durations.reduce((a, b) => a + b, 0);
    const avg = total / durations.length;
    const min = Math.min(...durations);
    const max = Math.max(...durations);

    return { total, avg, min, max, count: durations.length };
  }

  reset() {
    this.measurements = [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Performance & Load Testing", () => {
  let perfApp, perfDb, perfDbPath;
  let monitor;

  beforeEach(() => {
    const result = createPerfTestApp();
    perfApp = result.app;
    perfDb = result.db;
    perfDbPath = result.dbPath;
    monitor = new PerformanceMonitor();
  });

  afterEach(() => {
    if (fs.existsSync(perfDbPath)) fs.unlinkSync(perfDbPath);
  });

  describe("Response Time Measurements", () => {
    test("single decision submission should complete quickly", async () => {
      monitor.startMeasurement();
      const res = await request(perfApp)
        .post("/api/decision")
        .send({ profileId: "p1", decision: "like" });
      const duration = monitor.endMeasurement("single_decision");

      expect(res.status).toBe(200);
      expect(duration).toBeLessThan(100); // Should complete within 100ms
    });

    test("GET decisions should complete quickly with 100 records", async () => {
      // Insert 100 decisions
      for (let i = 0; i < 100; i++) {
        await request(perfApp)
          .post("/api/decision")
          .send({ profileId: `p${i}`, decision: "like" });
      }

      monitor.startMeasurement();
      const res = await request(perfApp).get("/api/decisions");
      const duration = monitor.endMeasurement("get_100_decisions");

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(100);
      expect(duration).toBeLessThan(500); // Should complete within 500ms
    });

    test("multiple sequential requests should maintain consistent response time", async () => {
      const durations = [];

      for (let i = 0; i < 10; i++) {
        monitor.startMeasurement();
        await request(perfApp)
          .post("/api/decision")
          .send({ profileId: `p${i}`, decision: "like" });
        durations.push(monitor.endMeasurement(`req_${i}`));
      }

      const avg = durations.reduce((a, b) => a + b) / durations.length;
      const max = Math.max(...durations);

      // Average should be under 100ms
      expect(avg).toBeLessThan(100);
      // No single request should take dramatically longer
      expect(max).toBeLessThan(300);
    });
  });

  describe("Throughput Testing", () => {
    test("should handle 50 concurrent requests", async () => {
      const promises = [];

      for (let i = 0; i < 50; i++) {
        promises.push(
          request(perfApp)
            .post("/api/decision")
            .send({ profileId: `p${i}`, decision: "like" })
        );
      }

      monitor.startMeasurement();
      const results = await Promise.all(promises);
      const duration = monitor.endMeasurement("50_concurrent");

      expect(results.every(r => r.status === 200)).toBe(true);
      expect(duration).toBeLessThan(2000); // Should complete within 2 seconds
    });

    test("should handle 100 concurrent requests", async () => {
      const promises = [];

      for (let i = 0; i < 100; i++) {
        promises.push(
          request(perfApp)
            .post("/api/decision")
            .send({ profileId: `p${i}`, decision: "like" })
        );
      }

      monitor.startMeasurement();
      const results = await Promise.all(promises);
      const duration = monitor.endMeasurement("100_concurrent");

      expect(results.every(r => r.status === 200)).toBe(true);
      expect(duration).toBeLessThan(3000);
    });

    test("should calculate throughput (requests per second)", async () => {
      const requestCount = 50;
      const promises = [];

      monitor.startMeasurement();
      for (let i = 0; i < requestCount; i++) {
        promises.push(
          request(perfApp)
            .post("/api/decision")
            .send({ profileId: `p${i}`, decision: "like" })
        );
      }
      await Promise.all(promises);
      const duration = monitor.endMeasurement("throughput_test");

      const throughput = (requestCount / duration) * 1000; // requests per second
      expect(throughput).toBeGreaterThan(10); // At least 10 reqs/sec
    });
  });

  describe("Large Dataset Performance", () => {
    test("should retrieve 1000 decisions efficiently", async () => {
      // Insert 1000 decisions
      for (let i = 0; i < 1000; i++) {
        await request(perfApp)
          .post("/api/decision")
          .send({ profileId: `p${i}`, decision: i % 3 === 0 ? "like" : "nope" });
      }

      monitor.startMeasurement();
      const res = await request(perfApp).get("/api/decisions");
      const duration = monitor.endMeasurement("retrieve_1000");

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1000);
      expect(duration).toBeLessThan(2000); // Should complete within 2 seconds
    });

    test("should handle memory usage with large dataset", async () => {
      // This is a basic check - actual memory would be monitored with profiler
      const initialMem = process.memoryUsage().heapUsed;

      for (let i = 0; i < 500; i++) {
        await request(perfApp)
          .post("/api/decision")
          .send({ profileId: `p${i}`, decision: "like" });
      }

      const afterInsertMem = process.memoryUsage().heapUsed;
      const memIncrease = afterInsertMem - initialMem;

      // Memory increase should be reasonable (not runaway)
      expect(memIncrease).toBeLessThan(50 * 1024 * 1024); // Less than 50MB
    });

    test("should maintain performance with growing dataset", async () => {
      const timings = [];

      for (let batch = 0; batch < 5; batch++) {
        monitor.startMeasurement();
        await request(perfApp).get("/api/decisions");
        timings.push(monitor.endMeasurement(`batch_${batch}`));

        // Insert 100 more decisions
        for (let i = 0; i < 100; i++) {
          await request(perfApp)
            .post("/api/decision")
            .send({ profileId: `p_${batch}_${i}`, decision: "like" });
        }
      }

      // Response times should not grow exponentially
      const lastTiming = timings[timings.length - 1];
      const firstTiming = timings[0];
      expect(lastTiming).toBeLessThan(firstTiming * 5); // Max 5x slower
    });
  });

  describe("Load Testing Under Stress", () => {
    test("should handle sustained load (250 requests in quick succession)", async () => {
      const promises = [];

      monitor.startMeasurement();
      for (let i = 0; i < 250; i++) {
        promises.push(
          request(perfApp)
            .post("/api/decision")
            .send({ profileId: `p${i}`, decision: i % 3 === 0 ? "like" : "nope" })
        );
      }

      const results = await Promise.allSettled(promises);
      const duration = monitor.endMeasurement("sustained_load");

      const successCount = results.filter(r => r.status === "fulfilled").length;
      expect(successCount).toBeGreaterThan(240); // At least 96% success rate

      // Should complete in reasonable time
      expect(duration).toBeLessThan(5000);
    });

    test("should not crash under load with mixed operations", async () => {
      const promises = [];

      for (let i = 0; i < 100; i++) {
        if (i % 2 === 0) {
          promises.push(
            request(perfApp)
              .post("/api/decision")
              .send({ profileId: `p${i}`, decision: "like" })
          );
        } else {
          promises.push(request(perfApp).get("/api/decisions"));
        }
      }

      monitor.startMeasurement();
      const results = await Promise.allSettled(promises);
      const duration = monitor.endMeasurement("mixed_ops");

      const succeeded = results.filter(r => r.status === "fulfilled").length;
      expect(succeeded).toBeGreaterThan(90); // 90%+ success
      expect(duration).toBeLessThan(3000);
    });
  });

  describe("Performance Monitor Utility", () => {
    test("should track measurements", () => {
      monitor.startMeasurement();
      setTimeout(() => {}, 10);
      monitor.endMeasurement("test1");

      monitor.startMeasurement();
      setTimeout(() => {}, 10);
      monitor.endMeasurement("test2");

      expect(monitor.measurements.length).toBe(2);
    });

    test("should calculate statistics", () => {
      monitor.measurements = [
        { label: "op1", duration: 10 },
        { label: "op2", duration: 20 },
        { label: "op3", duration: 30 },
      ];

      const stats = monitor.getStats();

      expect(stats.total).toBe(60);
      expect(stats.avg).toBe(20);
      expect(stats.min).toBe(10);
      expect(stats.max).toBe(30);
      expect(stats.count).toBe(3);
    });

    test("should reset measurements", () => {
      monitor.measurements = [{ label: "test", duration: 100 }];
      monitor.reset();

      expect(monitor.measurements).toEqual([]);
    });
  });

  describe("Latency Percentiles", () => {
    test("should calculate p50, p95, p99 latencies", async () => {
      const durations = [];

      for (let i = 0; i < 100; i++) {
        monitor.startMeasurement();
        await request(perfApp)
          .post("/api/decision")
          .send({ profileId: `p${i}`, decision: "like" });
        durations.push(monitor.endMeasurement(`req_${i}`));
      }

      durations.sort((a, b) => a - b);

      const p50 = durations[Math.floor(durations.length * 0.5)];
      const p95 = durations[Math.floor(durations.length * 0.95)];
      const p99 = durations[Math.floor(durations.length * 0.99)];

      expect(p50).toBeLessThan(100);
      expect(p95).toBeLessThan(200);
      expect(p99).toBeLessThan(300);
    });
  });

  describe("Resource Utilization", () => {
    test("should not grow unbounded memory with requests", async () => {
      const memBefore = process.memoryUsage().heapUsed;

      for (let i = 0; i < 200; i++) {
        await request(perfApp)
          .post("/api/decision")
          .send({ profileId: `p${i}`, decision: "like" });
      }

      const memAfter = process.memoryUsage().heapUsed;
      const delta = memAfter - memBefore;

      // Memory increase should be bounded
      expect(delta).toBeLessThan(100 * 1024 * 1024); // Less than 100MB
    });

    test("should handle request spikes", async () => {
      const spikeSize = 150;
      const promises = [];

      // Spike of requests
      for (let i = 0; i < spikeSize; i++) {
        promises.push(
          request(perfApp)
            .post("/api/decision")
            .send({ profileId: `spike_${i}`, decision: "like" })
        );
      }

      const results = await Promise.allSettled(promises);
      const successCount = results.filter(r => r.status === "fulfilled").length;

      // Should handle spike gracefully
      expect(successCount).toBeGreaterThan(spikeSize * 0.95); // 95%+ success
    });
  });
});
