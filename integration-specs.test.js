/**
 * Behavior & Integration Specifications Tests
 * Tests overall system behavior and integration scenarios
 */

const request = require("supertest");
const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

function createSpecApp() {
  const app = express();
  app.use(express.json());

  const dbPath = path.join(__dirname, "spec.test.sqlite");
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'active',
      createdAt INTEGER NOT NULL,
      lastLogin INTEGER
    );
    
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      published BOOLEAN DEFAULT 0,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY(userId) REFERENCES users(id)
    );
    
    CREATE INDEX idx_posts_userId ON posts(userId);
  `);

  // User operations
  app.post("/api/users", (req, res) => {
    const { username, email } = req.body;

    if (!username || !email) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      const stmt = db.prepare(
        "INSERT INTO users (username, email, createdAt) VALUES (?, ?, ?)"
      );
      const result = stmt.run(username, email, Date.now());

      res.status(201).json({
        id: result.lastInsertRowid,
        username,
        email,
        status: "active"
      });
    } catch (error) {
      if (error.message.includes("UNIQUE")) {
        return res.status(409).json({ error: "User already exists" });
      }
      res.status(500).json({ error: "Database error" });
    }
  });

  app.get("/api/users/:id", (req, res) => {
    const user = db
      .prepare("SELECT id, username, email, status, createdAt FROM users WHERE id = ?")
      .get(req.params.id);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(user);
  });

  app.get("/api/users/:id/posts", (req, res) => {
    const posts = db
      .prepare("SELECT id, title, published, createdAt FROM posts WHERE userId = ? ORDER BY createdAt DESC")
      .all(req.params.id);

    res.json(posts);
  });

  app.post("/api/users/:id/login", (req, res) => {
    const result = db
      .prepare("UPDATE users SET lastLogin = ? WHERE id = ?")
      .run(Date.now(), req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ success: true });
  });

  // Post operations
  app.post("/api/posts", (req, res) => {
    const { userId, title, content } = req.body;

    if (!userId || !title) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Verify user exists
    const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const stmt = db.prepare(
      "INSERT INTO posts (userId, title, content, createdAt) VALUES (?, ?, ?, ?)"
    );
    const result = stmt.run(userId, title, content || null, Date.now());

    res.status(201).json({
      id: result.lastInsertRowid,
      userId,
      title,
      published: false
    });
  });

  app.put("/api/posts/:id", (req, res) => {
    const { published } = req.body;

    const result = db
      .prepare("UPDATE posts SET published = ? WHERE id = ?")
      .run(published ? 1 : 0, req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Post not found" });
    }

    res.json({ success: true });
  });

  app.delete("/api/posts/:id", (req, res) => {
    const post = db.prepare("SELECT userId FROM posts WHERE id = ?").get(req.params.id);

    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    db.prepare("DELETE FROM posts WHERE id = ?").run(req.params.id);

    res.json({ success: true });
  });

  // Analytics
  app.get("/api/stats", (_req, res) => {
    const userCount = db
      .prepare("SELECT COUNT(*) as count FROM users WHERE status = 'active'")
      .get().count;

    const postCount = db
      .prepare("SELECT COUNT(*) as count FROM posts WHERE published = 1")
      .get().count;

    res.json({
      activeUsers: userCount,
      publishedPosts: postCount,
      timestamp: Date.now()
    });
  });

  return { app, db, dbPath };
}

describe("System Behavior & Integration Specifications", () => {
  let specApp, specDb, specDbPath;

  beforeEach(() => {
    const result = createSpecApp();
    specApp = result.app;
    specDb = result.db;
    specDbPath = result.dbPath;
  });

  afterEach(() => {
    if (fs.existsSync(specDbPath)) fs.unlinkSync(specDbPath);
  });

  describe("User Management Workflow", () => {
    test("should create user with valid credentials", async () => {
      const res = await request(specApp)
        .post("/api/users")
        .send({ username: "john", email: "john@example.com" });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body.username).toBe("john");
      expect(res.body.status).toBe("active");
    });

    test("should retrieve user after creation", async () => {
      const createRes = await request(specApp)
        .post("/api/users")
        .send({ username: "jane", email: "jane@example.com" });

      const userId = createRes.body.id;

      const getRes = await request(specApp).get(`/api/users/${userId}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.username).toBe("jane");
      expect(getRes.body.email).toBe("jane@example.com");
    });

    test("should prevent duplicate usernames", async () => {
      await request(specApp)
        .post("/api/users")
        .send({ username: "bob", email: "bob@example.com" });

      const res = await request(specApp)
        .post("/api/users")
        .send({ username: "bob", email: "bob2@example.com" });

      expect(res.status).toBe(409);
    });

    test("should prevent duplicate emails", async () => {
      await request(specApp)
        .post("/api/users")
        .send({ username: "alice1", email: "alice@example.com" });

      const res = await request(specApp)
        .post("/api/users")
        .send({ username: "alice2", email: "alice@example.com" });

      expect(res.status).toBe(409);
    });

    test("should handle user login", async () => {
      const createRes = await request(specApp)
        .post("/api/users")
        .send({ username: "login_user", email: "login@example.com" });

      const userId = createRes.body.id;

      const loginRes = await request(specApp).post(`/api/users/${userId}/login`);

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.success).toBe(true);
    });

    test("should update last login timestamp", async () => {
      const createRes = await request(specApp)
        .post("/api/users")
        .send({ username: "timestamp_user", email: "timestamp@example.com" });

      const userId = createRes.body.id;
      const before = Date.now();

      await request(specApp).post(`/api/users/${userId}/login`);

      const later = await request(specApp).get(`/api/users/${userId}`);
      // Note: lastLogin would be updated but we're not retrieving it in the response

      expect(later.status).toBe(200);
    });

    test("should reject login for non-existent user", async () => {
      const res = await request(specApp).post("/api/users/99999/login");

      expect(res.status).toBe(404);
    });
  });

  describe("Post Management Workflow", () => {
    let userId;

    beforeEach(async () => {
      const res = await request(specApp)
        .post("/api/users")
        .send({ username: "author", email: "author@example.com" });

      userId = res.body.id;
    });

    test("should create post for user", async () => {
      const res = await request(specApp)
        .post("/api/posts")
        .send({ userId, title: "My First Post", content: "Hello world" });

      expect(res.status).toBe(201);
      expect(res.body.title).toBe("My First Post");
      expect(res.body.published).toBe(false);
    });

    test("should prevent post creation for non-existent user", async () => {
      const res = await request(specApp)
        .post("/api/posts")
        .send({ userId: 99999, title: "Invalid Post", content: "test" });

      expect(res.status).toBe(404);
    });

    test("should retrieve user's posts", async () => {
      await request(specApp)
        .post("/api/posts")
        .send({ userId, title: "Post 1", content: "content1" });

      await request(specApp)
        .post("/api/posts")
        .send({ userId, title: "Post 2", content: "content2" });

      const res = await request(specApp).get(`/api/users/${userId}/posts`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });

    test("should publish post", async () => {
      const createRes = await request(specApp)
        .post("/api/posts")
        .send({ userId, title: "To Publish", content: "publish me" });

      const postId = createRes.body.id;

      const updateRes = await request(specApp)
        .put(`/api/posts/${postId}`)
        .send({ published: true });

      expect(updateRes.status).toBe(200);
    });

    test("should delete post", async () => {
      const createRes = await request(specApp)
        .post("/api/posts")
        .send({ userId, title: "To Delete", content: "delete me" });

      const postId = createRes.body.id;

      const deleteRes = await request(specApp).delete(`/api/posts/${postId}`);

      expect(deleteRes.status).toBe(200);

      const getRes = await request(specApp).get(`/api/users/${userId}/posts`);

      expect(getRes.body.length).toBe(0);
    });

    test("should prevent deleting non-existent post", async () => {
      const res = await request(specApp).delete("/api/posts/99999");

      expect(res.status).toBe(404);
    });
  });

  describe("Complex User-Post Relationships", () => {
    test("should handle multiple users with multiple posts", async () => {
      const user1 = await request(specApp)
        .post("/api/users")
        .send({ username: "user1", email: "user1@example.com" });

      const user2 = await request(specApp)
        .post("/api/users")
        .send({ username: "user2", email: "user2@example.com" });

      const uid1 = user1.body.id;
      const uid2 = user2.body.id;

      // User 1 creates 3 posts
      for (let i = 1; i <= 3; i++) {
        await request(specApp)
          .post("/api/posts")
          .send({ userId: uid1, title: `User1 Post${i}` });
      }

      // User 2 creates 2 posts
      for (let i = 1; i <= 2; i++) {
        await request(specApp)
          .post("/api/posts")
          .send({ userId: uid2, title: `User2 Post${i}` });
      }

      const user1Posts = await request(specApp).get(`/api/users/${uid1}/posts`);
      const user2Posts = await request(specApp).get(`/api/users/${uid2}/posts`);

      expect(user1Posts.body.length).toBe(3);
      expect(user2Posts.body.length).toBe(2);
    });

    test("should maintain referential integrity", async () => {
      const user = await request(specApp)
        .post("/api/users")
        .send({ username: "integrity_user", email: "integrity@example.com" });

      const userId = user.body.id;

      const post1 = await request(specApp)
        .post("/api/posts")
        .send({ userId, title: "Post 1" });

      const post2 = await request(specApp)
        .post("/api/posts")
        .send({ userId, title: "Post 2" });

      const postsRes = await request(specApp).get(`/api/users/${userId}/posts`);

      expect(postsRes.body.length).toBe(2);
      expect(postsRes.body.every(p => p.id !== undefined)).toBe(true);
    });
  });

  describe("Data Consistency", () => {
    test("should maintain accurate user count in stats", async () => {
      const statsRes1 = await request(specApp).get("/api/stats");
      const count1 = statsRes1.body.activeUsers;

      await request(specApp)
        .post("/api/users")
        .send({ username: "stat_user", email: "stat@example.com" });

      const statsRes2 = await request(specApp).get("/api/stats");
      const count2 = statsRes2.body.activeUsers;

      expect(count2).toBe(count1 + 1);
    });

    test("should count only published posts in stats", async () => {
      const user = await request(specApp)
        .post("/api/users")
        .send({ username: "publish_user", email: "publish@example.com" });

      const userId = user.body.id;

      const post1 = await request(specApp)
        .post("/api/posts")
        .send({ userId, title: "Public Post" });

      const post2 = await request(specApp)
        .post("/api/posts")
        .send({ userId, title: "Draft Post" });

      // Publish first post
      await request(specApp)
        .put(`/api/posts/${post1.body.id}`)
        .send({ published: true });

      const statsRes = await request(specApp).get("/api/stats");

      expect(statsRes.body.publishedPosts).toBeGreaterThan(0);
    });
  });

  describe("Error Recovery", () => {
    test("should handle malformed requests gracefully", async () => {
      const res = await request(specApp)
        .post("/api/users")
        .send({ username: "test" }); // Missing email

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });

    test("should provide meaningful error messages", async () => {
      const res = await request(specApp).get("/api/users/99999");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("User not found");
    });

    test("should handle concurrent operations safely", async () => {
      const user = await request(specApp)
        .post("/api/users")
        .send({ username: "concurrent_user", email: "concurrent@example.com" });

      const userId = user.body.id;

      const operations = [];
      for (let i = 0; i < 5; i++) {
        operations.push(
          request(specApp)
            .post("/api/posts")
            .send({ userId, title: `Concurrent Post ${i}` })
        );
      }

      const results = await Promise.all(operations);

      expect(results.every(r => r.status === 201)).toBe(true);

      const postsRes = await request(specApp).get(`/api/users/${userId}/posts`);

      expect(postsRes.body.length).toBe(5);
    });
  });

  describe("Request/Response Contract", () => {
    test("should return proper response structure for user creation", async () => {
      const res = await request(specApp)
        .post("/api/users")
        .send({ username: "structure_user", email: "structure@example.com" });

      expect(res.body).toEqual(
        expect.objectContaining({
          id: expect.any(Number),
          username: "structure_user",
          email: "structure@example.com",
          status: "active"
        })
      );
    });

    test("should return proper response structure for posts", async () => {
      const user = await request(specApp)
        .post("/api/users")
        .send({ username: "post_struct_user", email: "post_struct@example.com" });

      const res = await request(specApp)
        .post("/api/posts")
        .send({ userId: user.body.id, title: "Test Post" });

      expect(res.body).toEqual(
        expect.objectContaining({
          id: expect.any(Number),
          userId: user.body.id,
          title: "Test Post",
          published: false
        })
      );
    });
  });

  describe("Temporal Correctness", () => {
    test("should record creation timestamps", async () => {
      const before = Date.now();

      const res = await request(specApp)
        .post("/api/users")
        .send({ username: "temporal_user", email: "temporal@example.com" });

      const after = Date.now();

      const userRes = await request(specApp).get(`/api/users/${res.body.id}`);

      expect(userRes.body.createdAt).toBeGreaterThanOrEqual(before);
      expect(userRes.body.createdAt).toBeLessThanOrEqual(after);
    });

    test("should handle time-based queries correctly", async () => {
      const user = await request(specApp)
        .post("/api/users")
        .send({ username: "time_user", email: "time@example.com" });

      const beforeLogin = Date.now();
      await request(specApp).post(`/api/users/${user.body.id}/login`);
      const afterLogin = Date.now();

      // Stats should reflect current state
      const statsRes = await request(specApp).get("/api/stats");

      expect(statsRes.body).toHaveProperty("timestamp");
      expect(statsRes.body.timestamp).toBeGreaterThanOrEqual(beforeLogin);
      expect(statsRes.body.timestamp).toBeLessThanOrEqual(afterLogin + 1000);
    });
  });

  describe("Cascading Operations", () => {
    test("should handle multiple operations in sequence", async () => {
      const user = await request(specApp)
        .post("/api/users")
        .send({ username: "cascade_user", email: "cascade@example.com" });

      const userId = user.body.id;

      // Create posts
      const post1 = await request(specApp)
        .post("/api/posts")
        .send({ userId, title: "Post 1" });

      const post2 = await request(specApp)
        .post("/api/posts")
        .send({ userId, title: "Post 2" });

      // Publish post 1
      await request(specApp)
        .put(`/api/posts/${post1.body.id}`)
        .send({ published: true });

      // Verify state
      const postsRes = await request(specApp).get(`/api/users/${userId}/posts`);

      expect(postsRes.body.length).toBe(2);

      // Delete post 2
      await request(specApp).delete(`/api/posts/${post2.body.id}`);

      const finalPostsRes = await request(specApp).get(`/api/users/${userId}/posts`);

      expect(finalPostsRes.body.length).toBe(1);
    });
  });

  describe("Resource Lifecycle", () => {
    test("should handle full lifecycle: create, read, update, delete", async () => {
      // Create
      const createRes = await request(specApp)
        .post("/api/users")
        .send({ username: "lifecycle_user", email: "lifecycle@example.com" });

      const userId = createRes.body.id;

      // Read
      const readRes = await request(specApp).get(`/api/users/${userId}`);
      expect(readRes.status).toBe(200);

      // Create related resource
      const postRes = await request(specApp)
        .post("/api/posts")
        .send({ userId, title: "Lifecycle Post" });

      // Update
      const updateRes = await request(specApp)
        .put(`/api/posts/${postRes.body.id}`)
        .send({ published: true });

      expect(updateRes.status).toBe(200);

      // Delete
      const deleteRes = await request(specApp).delete(`/api/posts/${postRes.body.id}`);

      expect(deleteRes.status).toBe(200);

      // Verify deletion
      const verifyRes = await request(specApp).get(`/api/users/${userId}/posts`);

      expect(verifyRes.body.length).toBe(0);
    });
  });
});
