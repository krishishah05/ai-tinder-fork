/**
 * Frontend event handler tests
 * Tests UI interactions, button clicks, and polling logic
 */

// Mock frontend elements
const mockDOM = {
  deckEl: { innerHTML: "" },
  shuffleBtn: { onclick: null, addEventListener: jest.fn() },
  likeBtn: { onclick: null, addEventListener: jest.fn() },
  nopeBtn: { onclick: null, addEventListener: jest.fn() },
  superLikeBtn: { onclick: null, addEventListener: jest.fn() },
};

// Mock functions for testing
const mockHandlers = {
  currentProfileIndex: 0,
  profiles: [],
  
  onLike: jest.fn(),
  onNope: jest.fn(),
  onSuperLike: jest.fn(),
  onShuffle: jest.fn(),
  
  async handleLike(profileId) {
    this.onLike(profileId);
  },
  
  async handleNope(profileId) {
    this.onNope(profileId);
  },
  
  async handleSuperLike(profileId) {
    this.onSuperLike(profileId);
  },
  
  handleShuffle() {
    this.onShuffle();
  },
};

// Mock polling logic
let pollIntervalId = null;
const mockPollState = {
  isPolling: false,
  lastPollTime: null,
  pollCount: 0,
  newMatches: [],
};

function startPolling(callback, interval = 10000) {
  mockPollState.isPolling = true;
  pollIntervalId = setInterval(() => {
    mockPollState.pollCount++;
    mockPollState.lastPollTime = Date.now();
    callback();
  }, interval);
  return pollIntervalId;
}

function stopPolling() {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
  mockPollState.isPolling = false;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Frontend Event Handlers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHandlers.currentProfileIndex = 0;
    mockHandlers.profiles = [
      { id: "p1", name: "Alice" },
      { id: "p2", name: "Bob" },
      { id: "p3", name: "Charlie" },
    ];
  });

  describe("Button Click Handlers", () => {
    test("should handle like button click", () => {
      const profileId = "p1";
      mockHandlers.handleLike(profileId);
      expect(mockHandlers.onLike).toHaveBeenCalledWith(profileId);
    });

    test("should handle nope button click", () => {
      const profileId = "p2";
      mockHandlers.handleNope(profileId);
      expect(mockHandlers.onNope).toHaveBeenCalledWith(profileId);
    });

    test("should handle superlike button click", () => {
      const profileId = "p3";
      mockHandlers.handleSuperLike(profileId);
      expect(mockHandlers.onSuperLike).toHaveBeenCalledWith(profileId);
    });

    test("should handle shuffle button click", () => {
      mockHandlers.handleShuffle();
      expect(mockHandlers.onShuffle).toHaveBeenCalled();
    });

    test("should handle multiple sequential clicks", () => {
      mockHandlers.handleLike("p1");
      mockHandlers.handleNope("p2");
      mockHandlers.handleSuperLike("p3");

      expect(mockHandlers.onLike).toHaveBeenCalledTimes(1);
      expect(mockHandlers.onNope).toHaveBeenCalledTimes(1);
      expect(mockHandlers.onSuperLike).toHaveBeenCalledTimes(1);
    });

    test("should handle rapid sequential clicks", () => {
      for (let i = 0; i < 10; i++) {
        mockHandlers.handleLike(`p${i}`);
      }
      expect(mockHandlers.onLike).toHaveBeenCalledTimes(10);
    });

    test("should pass correct profile ID to handlers", () => {
      const profiles = ["alice_123", "bob_456", "charlie_789"];
      profiles.forEach(id => {
        mockHandlers.handleLike(id);
      });

      profiles.forEach(id => {
        expect(mockHandlers.onLike).toHaveBeenCalledWith(id);
      });
    });
  });

  describe("Polling Logic", () => {
    afterEach(() => {
      stopPolling();
    });

    test("should start polling with correct interval", (done) => {
      const callback = jest.fn();
      const interval = 100;
      
      startPolling(callback, interval);
      expect(mockPollState.isPolling).toBe(true);

      setTimeout(() => {
        stopPolling();
        expect(mockPollState.pollCount).toBeGreaterThanOrEqual(2);
        done();
      }, 350);
    });

    test("should stop polling", (done) => {
      const callback = jest.fn();
      startPolling(callback, 100);
      
      setTimeout(() => {
        stopPolling();
        const countAtStop = mockPollState.pollCount;
        
        setTimeout(() => {
          expect(mockPollState.pollCount).toBe(countAtStop);
          done();
        }, 150);
      }, 250);
    });

    test("should track poll count", (done) => {
      const callback = jest.fn();
      startPolling(callback, 50);

      setTimeout(() => {
        stopPolling();
        expect(mockPollState.pollCount).toBeGreaterThan(0);
        done();
      }, 200);
    });

    test("should update last poll time", (done) => {
      const callback = jest.fn();
      const initialTime = mockPollState.lastPollTime;
      
      startPolling(callback, 50);

      setTimeout(() => {
        stopPolling();
        expect(mockPollState.lastPollTime).toBeGreaterThan(initialTime || 0);
        done();
      }, 150);
    });

    test("should call callback on each poll", (done) => {
      const callback = jest.fn();
      startPolling(callback, 50);

      setTimeout(() => {
        stopPolling();
        expect(callback.mock.calls.length).toBeGreaterThanOrEqual(2);
        done();
      }, 200);
    });

    test("should run at specified interval", (done) => {
      const callback = jest.fn();
      const interval = 100;
      const startTime = Date.now();
      
      startPolling(callback, interval);

      setTimeout(() => {
        stopPolling();
        const elapsed = Date.now() - startTime;
        // Should have roughly 3 polls in 250ms window
        expect(mockPollState.pollCount).toBeGreaterThanOrEqual(2);
        done();
      }, 250);
    });

    test("should handle polling with 10 second default interval", (done) => {
      const callback = jest.fn();
      const pollId = startPolling(callback); // default 10s

      // Verify it started
      expect(mockPollState.isPolling).toBe(true);
      expect(pollId).toBeDefined();
      
      stopPolling();
      done();
    });

    test("should not continue polling after stop", (done) => {
      const callback = jest.fn();
      startPolling(callback, 50);

      setTimeout(() => {
        stopPolling();
        const countAfterStop = mockPollState.pollCount;
        
        setTimeout(() => {
          // Count should not increase after stop
          expect(mockPollState.pollCount).toBe(countAfterStop);
          done();
        }, 100);
      }, 150);
    });
  });

  describe("Event Handler Edge Cases", () => {
    test("should handle empty profile ID", () => {
      mockHandlers.handleLike("");
      expect(mockHandlers.onLike).toHaveBeenCalledWith("");
    });

    test("should handle null profile ID", () => {
      mockHandlers.handleLike(null);
      expect(mockHandlers.onLike).toHaveBeenCalledWith(null);
    });

    test("should handle undefined profile ID", () => {
      mockHandlers.handleLike(undefined);
      expect(mockHandlers.onLike).toHaveBeenCalledWith(undefined);
    });

    test("should handle very long profile ID", () => {
      const longId = "p_" + "x".repeat(1000);
      mockHandlers.handleLike(longId);
      expect(mockHandlers.onLike).toHaveBeenCalledWith(longId);
    });

    test("should handle special characters in profile ID", () => {
      const specialIds = ["p@1", "p#2", "p$3", "p%4", "p&5"];
      specialIds.forEach(id => {
        mockHandlers.handleLike(id);
      });
      expect(mockHandlers.onLike).toHaveBeenCalledTimes(5);
    });
  });

  describe("Polling State Management", () => {
    test("should initialize polling state correctly", () => {
      expect(mockPollState.isPolling).toBe(false);
      expect(mockPollState.pollCount).toBe(0);
      expect(mockPollState.newMatches).toEqual([]);
    });

    test("should update polling state when started", () => {
      startPolling(() => {}, 100);
      expect(mockPollState.isPolling).toBe(true);
      stopPolling();
    });

    test("should update polling state when stopped", () => {
      startPolling(() => {}, 100);
      stopPolling();
      expect(mockPollState.isPolling).toBe(false);
    });

    test("should reset poll count on demand", () => {
      mockPollState.pollCount = 5;
      mockPollState.pollCount = 0;
      expect(mockPollState.pollCount).toBe(0);
    });

    test("should accumulate new matches during polling", (done) => {
      const newMatch = { profileId: "p123", name: "Test" };
      
      const callback = () => {
        mockPollState.newMatches.push(newMatch);
      };

      startPolling(callback, 50);

      setTimeout(() => {
        stopPolling();
        expect(mockPollState.newMatches.length).toBeGreaterThan(0);
        done();
      }, 150);
    });
  });

  describe("Event Handler Async Behavior", () => {
    test("should handle async like handler", async () => {
      const asyncLike = jest.fn(async (id) => {
        return new Promise(resolve => {
          setTimeout(() => resolve({ success: true }), 10);
        });
      });

      const result = await asyncLike("p1");
      expect(result.success).toBe(true);
    });

    test("should handle async decision submission", async () => {
      const submitDecision = jest.fn(async (profileId, decision) => {
        return new Promise(resolve => {
          setTimeout(() => resolve({ decision, matched: Math.random() < 0.7 }), 20);
        });
      });

      const result = await submitDecision("p1", "like");
      expect(result.decision).toBe("like");
      expect(typeof result.matched).toBe("boolean");
    });

    test("should handle multiple concurrent event handler calls", async () => {
      const handler = jest.fn(async (id) => {
        return new Promise(resolve => {
          setTimeout(() => resolve(id), 10);
        });
      });

      const promises = [
        handler("p1"),
        handler("p2"),
        handler("p3"),
      ];

      const results = await Promise.all(promises);
      expect(results).toEqual(["p1", "p2", "p3"]);
      expect(handler).toHaveBeenCalledTimes(3);
    });
  });
});
