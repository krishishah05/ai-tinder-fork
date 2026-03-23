/**
 * Database transaction and memory tests
 * Tests database rollback scenarios and memory leak detection
 */

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

// ─────────────────────────────────────────────────────────────────────────────

describe("Database Transactions", () => {
  let db;
  let dbPath;

  beforeEach(() => {
    dbPath = path.join(__dirname, "transaction.test.sqlite");
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    db = new Database(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY,
        name TEXT,
        balance REAL
      );
      
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_account INTEGER,
        to_account INTEGER,
        amount REAL,
        status TEXT DEFAULT 'pending'
      );
    `);

    db.prepare("INSERT INTO accounts (id, name, balance) VALUES (1, 'Alice', 1000)").run();
    db.prepare("INSERT INTO accounts (id, name, balance) VALUES (2, 'Bob', 500)").run();
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  describe("Transaction Basics", () => {
    test("should commit successful transaction", () => {
      const stmt = db.prepare("UPDATE accounts SET balance = balance - ? WHERE id = ?");

      db.exec("BEGIN");
      stmt.run(100, 1); // Alice loses 100
      db.exec("COMMIT");

      const result = db.prepare("SELECT balance FROM accounts WHERE id = 1").get();
      expect(result.balance).toBe(900);
    });

    test("should rollback failed transaction", () => {
      const stmtUpdate = db.prepare("UPDATE accounts SET balance = balance - ? WHERE id = ?");

      db.exec("BEGIN");
      stmtUpdate.run(100, 1); // Alice loses 100

      const result1 = db.prepare("SELECT balance FROM accounts WHERE id = 1").get();
      expect(result1.balance).toBe(900); // Changed in transaction

      db.exec("ROLLBACK");

      const result2 = db.prepare("SELECT balance FROM accounts WHERE id = 1").get();
      expect(result2.balance).toBe(1000); // Back to original
    });

    test("should maintain consistency with transactions", () => {
      const transfer = (from, to, amount) => {
        try {
          db.exec("BEGIN");

          db.prepare("UPDATE accounts SET balance = balance - ? WHERE id = ?").run(
            amount,
            from
          );

          const fromBalance = db
            .prepare("SELECT balance FROM accounts WHERE id = ?")
            .get(from).balance;

          if (fromBalance < 0) {
            db.exec("ROLLBACK");
            return false;
          }

          db.prepare("UPDATE accounts SET balance = balance + ? WHERE id = ?").run(
            amount,
            to
          );

          db.exec("COMMIT");
          return true;
        } catch (e) {
          db.exec("ROLLBACK");
          return false;
        }
      };

      // Valid transfer
      expect(transfer(1, 2, 200)).toBe(true);

      const alice = db.prepare("SELECT balance FROM accounts WHERE id = 1").get();
      const bob = db.prepare("SELECT balance FROM accounts WHERE id = 2").get();

      expect(alice.balance).toBe(800);
      expect(bob.balance).toBe(700);

      // Invalid transfer (Alice doesn't have enough)
      expect(transfer(1, 2, 1000)).toBe(false);

      const aliceAfter = db.prepare("SELECT balance FROM accounts WHERE id = 1").get();
      expect(aliceAfter.balance).toBe(800); // Unchanged
    });

    test("should support nested transactions", () => {
      const savepoint = "sp1";

      db.exec("BEGIN");

      db.prepare("UPDATE accounts SET balance = balance - 100 WHERE id = 1").run();

      db.exec(`SAVEPOINT ${savepoint}`);

      db.prepare("UPDATE accounts SET balance = balance - 200 WHERE id = 1").run();

      db.exec(`ROLLBACK TO ${savepoint}`);

      db.exec("COMMIT");

      const result = db.prepare("SELECT balance FROM accounts WHERE id = 1").get();
      expect(result.balance).toBe(900); // Only first update committed
    });
  });

  describe("Rollback Scenarios", () => {
    test("should rollback on constraint violation", () => {
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT UNIQUE)");
      const stmt = db.prepare("INSERT INTO test (id, value) VALUES (?, ?)");

      stmt.run(1, "unique_value");

      try {
        db.exec("BEGIN");
        stmt.run(2, "unique_value"); // Duplicate
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
      }

      const count = db.prepare("SELECT COUNT(*) as cnt FROM test").get().cnt;
      expect(count).toBe(1); // Only first insert succeeded
    });

    test("should rollback partial batch insert", () => {
      const stmt = db.prepare(
        "INSERT INTO transactions (from_account, to_account, amount) VALUES (?, ?, ?)"
      );

      db.exec("BEGIN");

      stmt.run(1, 2, 100);
      stmt.run(1, 2, 200);

      // Simulate error and rollback
      db.exec("ROLLBACK");

      const count = db.prepare("SELECT COUNT(*) as cnt FROM transactions").get().cnt;
      expect(count).toBe(0); // All rolled back
    });

    test("should maintain data integrity after rollback", () => {
      const transfer = (from, to, amount) => {
        db.exec("BEGIN");
        try {
          db.prepare("UPDATE accounts SET balance = balance - ? WHERE id = ?").run(
            amount,
            from
          );
          db.prepare("UPDATE accounts SET balance = balance + ? WHERE id = ?").run(
            amount,
            to
          );
          db.exec("COMMIT");
          return true;
        } catch (e) {
          db.exec("ROLLBACK");
          return false;
        }
      };

      const initialAlice = db
        .prepare("SELECT balance FROM accounts WHERE id = 1")
        .get().balance;
      const initialBob = db
        .prepare("SELECT balance FROM accounts WHERE id = 2")
        .get().balance;

      // Simulate failure mid-transaction
      transfer(1, 2, 300);

      const finalAlice = db
        .prepare("SELECT balance FROM accounts WHERE id = 1")
        .get().balance;
      const finalBob = db
        .prepare("SELECT balance FROM accounts WHERE id = 2")
        .get().balance;

      const totalBefore = initialAlice + initialBob;
      const totalAfter = finalAlice + finalBob;

      expect(totalAfter).toBe(totalBefore); // Conservation of balance
    });
  });

  describe("Concurrent Transactions", () => {
    test("should handle multiple sequential transactions", () => {
      for (let i = 0; i < 10; i++) {
        db.exec("BEGIN");
        db.prepare("UPDATE accounts SET balance = balance - 1 WHERE id = 1").run();
        db.exec("COMMIT");
      }

      const result = db.prepare("SELECT balance FROM accounts WHERE id = 1").get();
      expect(result.balance).toBe(990);
    });

    test("should handle transaction after rollback", () => {
      // First transaction rolls back
      db.exec("BEGIN");
      db.prepare("UPDATE accounts SET balance = balance - 100 WHERE id = 1").run();
      db.exec("ROLLBACK");

      // Second transaction succeeds
      db.exec("BEGIN");
      db.prepare("UPDATE accounts SET balance = balance - 50 WHERE id = 1").run();
      db.exec("COMMIT");

      const result = db.prepare("SELECT balance FROM accounts WHERE id = 1").get();
      expect(result.balance).toBe(950);
    });
  });

  describe("Large Transaction Handling", () => {
    test("should handle large batch insert in transaction", () => {
      const stmt = db.prepare(
        "INSERT INTO transactions (from_account, to_account, amount) VALUES (?, ?, ?)"
      );

      db.exec("BEGIN");

      for (let i = 0; i < 1000; i++) {
        stmt.run(1, 2, Math.random() * 100);
      }

      db.exec("COMMIT");

      const count = db.prepare("SELECT COUNT(*) as cnt FROM transactions").get().cnt;
      expect(count).toBe(1000);
    });

    test("should rollback large batch insert", () => {
      const stmt = db.prepare(
        "INSERT INTO transactions (from_account, to_account, amount) VALUES (?, ?, ?)"
      );

      db.exec("BEGIN");

      for (let i = 0; i < 500; i++) {
        stmt.run(1, 2, Math.random() * 100);
      }

      db.exec("ROLLBACK");

      const count = db.prepare("SELECT COUNT(*) as cnt FROM transactions").get().cnt;
      expect(count).toBe(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Memory Leak Detection", () => {
  let initialMemory;

  beforeEach(() => {
    if (global.gc) global.gc();
    initialMemory = process.memoryUsage().heapUsed;
  });

  describe("Memory Growth Monitoring", () => {
    test("should not leak memory with repeated database operations", () => {
      const dbPath = path.join(__dirname, "memory.test.sqlite");
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

      const db = new Database(dbPath);
      db.exec("CREATE TABLE test (id INTEGER, data TEXT)");
      const stmt = db.prepare("INSERT INTO test VALUES (?, ?)");

      for (let i = 0; i < 1000; i++) {
        stmt.run(i, `data_${i}`.repeat(10));
      }

      const afterInsert = process.memoryUsage().heapUsed;
      const growth1 = afterInsert - initialMemory;

      // Clear and repeat
      db.exec("DELETE FROM test");

      for (let i = 0; i < 1000; i++) {
        stmt.run(i, `data_${i}`.repeat(10));
      }

      const afterRepeat = process.memoryUsage().heapUsed;
      const growth2 = afterRepeat - afterInsert;

      db.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

      if (global.gc) global.gc();

      // Second operation should not grow significantly more than first
      expect(growth2).toBeLessThan(growth1 * 1.5); // Within 50%
    });

    test("should not leak with connection open/close cycles", () => {
      const dbPath = path.join(__dirname, "memory_cycle.test.sqlite");
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

      const measurements = [];

      for (let cycle = 0; cycle < 5; cycle++) {
        const db = new Database(dbPath);
        db.exec("CREATE TABLE IF NOT EXISTS test (id INTEGER)");

        for (let i = 0; i < 100; i++) {
          db.prepare("INSERT INTO test VALUES (?)").run(i);
        }

        db.close();

        if (global.gc) global.gc();
        measurements.push(process.memoryUsage().heapUsed);
      }

      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

      // Memory should stabilize after first few cycles
      const lastMeasurement = measurements[measurements.length - 1];
      const firstMeasurement = measurements[0];

      // Not growing unboundedly
      expect(lastMeasurement).toBeLessThan(firstMeasurement + 50 * 1024 * 1024);
    });

    test("should release memory after prepared statement execution", () => {
      const dbPath = path.join(__dirname, "memory_stmt.test.sqlite");
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

      const db = new Database(dbPath);
      db.exec("CREATE TABLE test (id INTEGER, data TEXT)");

      const before = process.memoryUsage().heapUsed;

      // Execute many statements
      for (let i = 0; i < 5000; i++) {
        db.prepare("INSERT INTO test VALUES (?, ?)").run(i, `data_${i}`);
      }

      const after = process.memoryUsage().heapUsed;

      // Clear data
      db.exec("DELETE FROM test");

      const after_clear = process.memoryUsage().heapUsed;

      db.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

      // Memory after clear should be less than peak
      const diff = after - before;
      const reclaimed = after - after_clear;

      expect(reclaimed).toBeGreaterThan(diff * 0.3); // Should reclaim at least 30%
    });
  });

  describe("Resource Cleanup", () => {
    test("should properly close database handle", () => {
      const dbPath = path.join(__dirname, "resource.test.sqlite");
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

      const db = new Database(dbPath);
      db.prepare("CREATE TABLE test (id INTEGER)").run();

      expect(db.open).toBe(true);

      db.close();

      expect(db.open).toBe(false);

      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    });

    test("should cleanup file handles", (done) => {
      const dbPath = path.join(__dirname, "cleanup.test.sqlite");
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

      const db = new Database(dbPath);
      db.prepare("CREATE TABLE test (id INTEGER)").run();
      db.close();

      // File should be accessible immediately after close
      setTimeout(() => {
        try {
          const stats = fs.statSync(dbPath);
          expect(stats.isFile()).toBe(true);

          fs.unlinkSync(dbPath);
          done();
        } catch (e) {
          done(e);
        }
      }, 100);
    });
  });

  describe("Memory Usage Patterns", () => {
    test("should show reasonable memory usage for typical workload", () => {
      const dbPath = path.join(__dirname, "workload.test.sqlite");
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE profiles (
          id INTEGER PRIMARY KEY,
          name TEXT,
          data TEXT
        )
      `);

      const before = process.memoryUsage().heapUsed;

      // Typical workload: 500 profiles
      for (let i = 0; i < 500; i++) {
        db.prepare(
          "INSERT INTO profiles (id, name, data) VALUES (?, ?, ?)"
        ).run(i, `Profile ${i}`, JSON.stringify({ index: i, timestamp: Date.now() }));
      }

      const after = process.memoryUsage().heapUsed;
      const footprint = after - before;

      db.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

      // Footprint should be reasonable (less than 100MB for 500 profiles)
      expect(footprint).toBeLessThan(100 * 1024 * 1024);
    });

    test("should track memory growth with increasing data", () => {
      const dbPath = path.join(__dirname, "growth.test.sqlite");
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

      const db = new Database(dbPath);
      db.exec("CREATE TABLE items (id INTEGER, data TEXT)");

      const measurements = [];

      for (let batch = 0; batch < 5; batch++) {
        if (global.gc) global.gc();
        const memBefore = process.memoryUsage().heapUsed;

        for (let i = 0; i < 100; i++) {
          db.prepare("INSERT INTO items VALUES (?, ?)").run(
            batch * 100 + i,
            `Item ${batch * 100 + i}`.repeat(100)
          );
        }

        const memAfter = process.memoryUsage().heapUsed;
        measurements.push({
          batch,
          growth: memAfter - memBefore,
        });
      }

      db.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

      // Growth should be consistent across batches
      const growths = measurements.map(m => m.growth);
      const avgGrowth = growths.reduce((a, b) => a + b) / growths.length;

      growths.forEach(growth => {
        // Each batch should grow similarly (within 2x factor)
        expect(growth).toBeLessThan(avgGrowth * 2);
      });
    });
  });
});
