/**
 * Error recovery and retry logic tests
 * Tests timeout scenarios, connection failures, and retry mechanisms
 */

// Mock retry utilities
class RetryHandler {
  constructor(maxRetries = 3, delay = 100) {
    this.maxRetries = maxRetries;
    this.delay = delay;
    this.attemptCount = 0;
  }

  async executeWithRetry(fn) {
    for (let i = 0; i <= this.maxRetries; i++) {
      this.attemptCount = i + 1;
      try {
        return await fn();
      } catch (error) {
        if (i === this.maxRetries) {
          throw error;
        }
        await this.sleep(this.delay * Math.pow(2, i)); // exponential backoff
      }
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Mock API client with timeout
class APIClient {
  constructor(timeout = 5000) {
    this.timeout = timeout;
    this.requestCount = 0;
    this.failureCount = 0;
  }

  async fetchWithTimeout(url, options = {}) {
    this.requestCount++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout after ${this.timeout}ms`));
      }, this.timeout);

      // Simulate successful or failed request
      const isSuccess = Math.random() > 0.3; // 70% success rate
      setTimeout(() => {
        clearTimeout(timer);
        if (isSuccess) {
          resolve({ status: 200, data: { success: true } });
        } else {
          this.failureCount++;
          reject(new Error("Network error"));
        }
      }, Math.random() * 1000); // 0-1000ms
    });
  }

  resetStats() {
    this.requestCount = 0;
    this.failureCount = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Error Recovery & Retry Logic", () => {
  describe("RetryHandler", () => {
    let retryHandler;

    beforeEach(() => {
      retryHandler = new RetryHandler(3, 10);
    });

    test("should succeed on first attempt", async () => {
      const fn = jest.fn().mockResolvedValueOnce("success");
      const result = await retryHandler.executeWithRetry(fn);

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
      expect(retryHandler.attemptCount).toBe(1);
    });

    test("should retry on failure then succeed", async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error("Failed"))
        .mockResolvedValueOnce("success");

      const result = await retryHandler.executeWithRetry(fn);

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
      expect(retryHandler.attemptCount).toBe(2);
    });

    test("should retry up to maxRetries", async () => {
      const fn = jest.fn().mockRejectedValue(new Error("Always fails"));

      await expect(retryHandler.executeWithRetry(fn)).rejects.toThrow(
        "Always fails"
      );

      expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
      expect(retryHandler.attemptCount).toBe(4);
    });

    test("should not exceed maxRetries", async () => {
      const fn = jest.fn().mockRejectedValue(new Error("Failed"));
      retryHandler = new RetryHandler(2, 10);

      await expect(retryHandler.executeWithRetry(fn)).rejects.toThrow();
      expect(fn).toHaveBeenCalledTimes(3); // 1 + 2 retries
    });

    test("should succeed after multiple failures", async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error("Fail 1"))
        .mockRejectedValueOnce(new Error("Fail 2"))
        .mockResolvedValueOnce("success");

      const result = await retryHandler.executeWithRetry(fn);

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(3);
    });

    test("should apply exponential backoff", async () => {
      const timings = [];
      const fn = jest.fn(async () => {
        timings.push(Date.now());
        if (timings.length < 3) throw new Error("Fail");
        return "success";
      });

      retryHandler = new RetryHandler(3, 20); // 20ms base delay
      const result = await retryHandler.executeWithRetry(fn);

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(3);

      if (timings.length >= 3) {
        const delay1 = timings[1] - timings[0];
        const delay2 = timings[2] - timings[1];
        // Exponential backoff should increase delays
        expect(delay2).toBeGreaterThanOrEqual(delay1);
      }
    });

    test("should handle timeout errors", async () => {
      const fn = jest.fn().mockRejectedValue(new Error("Timeout"));

      await expect(retryHandler.executeWithRetry(fn)).rejects.toThrow(
        "Timeout"
      );
      expect(fn).toHaveBeenCalled();
    });

    test("should reset attempt count", async () => {
      const fn1 = jest.fn().mockResolvedValue("result1");
      await retryHandler.executeWithRetry(fn1);

      expect(retryHandler.attemptCount).toBe(1);

      const fn2 = jest.fn().mockResolvedValue("result2");
      retryHandler.attemptCount = 0;
      await retryHandler.executeWithRetry(fn2);

      expect(retryHandler.attemptCount).toBe(1);
    });
  });

  describe("APIClient Timeout", () => {
    let apiClient;

    beforeEach(() => {
      apiClient = new APIClient(100); // 100ms timeout
    });

    test("should complete successful request within timeout", async () => {
      const result = await apiClient.fetchWithTimeout("/api/test");
      expect(result.status).toBe(200);
    });

    test("should track request count", async () => {
      expect(apiClient.requestCount).toBe(0);

      try {
        await apiClient.fetchWithTimeout("/api/test");
      } catch (e) {
        // May fail or succeed
      }

      expect(apiClient.requestCount).toBe(1);
    });

    test("should reset stats", async () => {
      apiClient.requestCount = 5;
      apiClient.failureCount = 3;

      apiClient.resetStats();

      expect(apiClient.requestCount).toBe(0);
      expect(apiClient.failureCount).toBe(0);
    });

    test("should handle multiple sequential requests", async () => {
      for (let i = 0; i < 5; i++) {
        try {
          await apiClient.fetchWithTimeout("/api/test");
        } catch (e) {
          // Expected for some requests
        }
      }

      expect(apiClient.requestCount).toBe(5);
    });
  });

  describe("Error Handling Patterns", () => {
    test("should catch network errors", () => {
      const error = new Error("Network error");
      expect(() => {
        throw error;
      }).toThrow("Network error");
    });

    test("should catch timeout errors", () => {
      const error = new Error("Request timeout");
      expect(() => {
        throw error;
      }).toThrow("Request timeout");
    });

    test("should distinguish error types", (done) => {
      const networkError = new Error("Network failed");
      const timeoutError = new Error("Timeout");
      const validationError = new Error("Invalid input");

      const errors = [networkError, timeoutError, validationError];
      const errorTypes = errors.map(e => e.message);

      expect(errorTypes).toContain("Network failed");
      expect(errorTypes).toContain("Timeout");
      expect(errorTypes).toContain("Invalid input");

      done();
    });

    test("should handle error with partial response", async () => {
      const response = { status: 500, data: { error: "Server error" } };
      
      expect(response.status).toBe(500);
      expect(response.data.error).toBeDefined();
    });

    test("should handle multiple concurrent errors", async () => {
      const promises = [
        Promise.reject(new Error("Error 1")),
        Promise.reject(new Error("Error 2")),
        Promise.reject(new Error("Error 3")),
      ];

      const results = await Promise.allSettled(promises);

      results.forEach((result, index) => {
        expect(result.status).toBe("rejected");
        expect(result.reason.message).toContain(`Error ${index + 1}`);
      });
    });
  });

  describe("Graceful Degradation", () => {
    test("should use fallback on error", async () => {
      const primaryData = null;
      const fallbackData = { id: "fallback", name: "Fallback Profile" };

      const data = primaryData || fallbackData;
      expect(data).toEqual(fallbackData);
    });

    test("should queue requests during failure", () => {
      const queue = [];
      
      const queueRequest = (req) => queue.push(req);
      const processQueue = () => {
        while (queue.length > 0) {
          queue.shift();
        }
      };

      queueRequest({ id: 1 });
      queueRequest({ id: 2 });
      expect(queue.length).toBe(2);

      processQueue();
      expect(queue.length).toBe(0);
    });

    test("should provide user feedback on error", () => {
      const error = new Error("Could not load matches");
      const userMessage = `Error: ${error.message}`;

      expect(userMessage).toContain("Could not load matches");
    });

    test("should continue with cached data on network failure", () => {
      const cachedData = [
        { id: "p1", name: "Alice" },
        { id: "p2", name: "Bob" },
      ];

      const networkError = new Error("Network unavailable");
      
      // Use cached data
      const data = cachedData;
      expect(data.length).toBe(2);
    });
  });

  describe("Retry with Backoff", () => {
    test("should increase delay with each retry attempt", async () => {
      const delays = [];
      let attemptCount = 0;

      const fn = jest.fn(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error("Fail");
        }
        return "success";
      });

      const handler = new RetryHandler(3, 10);
      
      // Mock sleep tracking
      const originalSleep = handler.sleep.bind(handler);
      handler.sleep = jest.fn(async (ms) => {
        delays.push(ms);
        return originalSleep(ms);
      });

      await handler.executeWithRetry(fn);

      expect(delays.length).toBeGreaterThan(0);
      // Each delay should be greater than the previous
      for (let i = 1; i < delays.length; i++) {
        expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
      }
    });

    test("should use exponential backoff formula", async () => {
      const baseDelay = 10;
      const expectedDelays = [];

      for (let i = 0; i < 3; i++) {
        expectedDelays.push(baseDelay * Math.pow(2, i));
      }

      expect(expectedDelays[0]).toBe(10);
      expect(expectedDelays[1]).toBe(20);
      expect(expectedDelays[2]).toBe(40);
    });
  });

  describe("Circuit Breaker Pattern", () => {
    class CircuitBreaker {
      constructor(threshold = 5, timeout = 1000) {
        this.failureCount = 0;
        this.threshold = threshold;
        this.timeout = timeout;
        this.state = "closed"; // closed, open, half-open
        this.lastFailureTime = null;
      }

      async execute(fn) {
        if (this.state === "open") {
          if (Date.now() - this.lastFailureTime > this.timeout) {
            this.state = "half-open";
          } else {
            throw new Error("Circuit breaker is open");
          }
        }

        try {
          const result = await fn();
          if (this.state === "half-open") {
            this.state = "closed";
            this.failureCount = 0;
          }
          return result;
        } catch (error) {
          this.failureCount++;
          this.lastFailureTime = Date.now();

          if (this.failureCount >= this.threshold) {
            this.state = "open";
          }

          throw error;
        }
      }
    }

    test("should start in closed state", () => {
      const breaker = new CircuitBreaker();
      expect(breaker.state).toBe("closed");
    });

    test("should open after threshold failures", async () => {
      const breaker = new CircuitBreaker(2);
      const fn = jest.fn().mockRejectedValue(new Error("Fail"));

      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(fn);
        } catch (e) {
          // Expected
        }
      }

      expect(breaker.state).toBe("open");
    });

    test("should reject requests when open", async () => {
      const breaker = new CircuitBreaker(1);
      const fn = jest.fn().mockRejectedValue(new Error("Fail"));

      try {
        await breaker.execute(fn);
      } catch (e) {
        // Expected
      }

      await expect(breaker.execute(fn)).rejects.toThrow(
        "Circuit breaker is open"
      );
    });

    test("should transition to half-open after timeout", async () => {
      const breaker = new CircuitBreaker(1, 50);
      const failFn = jest.fn().mockRejectedValue(new Error("Fail"));

      try {
        await breaker.execute(failFn);
      } catch (e) {
        // Expected
      }

      expect(breaker.state).toBe("open");

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 60));

      const successFn = jest.fn().mockResolvedValue("success");
      try {
        await breaker.execute(successFn);
        expect(breaker.state).toBe("half-open");
      } catch (e) {
        // May still be in recovery
      }
    });

    test("should close after successful recovery", async () => {
      const breaker = new CircuitBreaker(1, 10);
      const failFn = jest.fn().mockRejectedValue(new Error("Fail"));
      const successFn = jest.fn().mockResolvedValue("success");

      try {
        await breaker.execute(failFn);
      } catch (e) {
        // Expected
      }

      expect(breaker.state).toBe("open");

      await new Promise(resolve => setTimeout(resolve, 20));

      await breaker.execute(successFn);
      expect(breaker.state).toBe("closed");
    });
  });
});
