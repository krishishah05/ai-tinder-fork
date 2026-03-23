const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

function setupDom() {
  const html = `<!doctype html>
    <html>
      <body>
        <main>
          <div id="deck" aria-live="polite" aria-busy="true"></div>
          <button id="shuffleBtn"></button>
          <button id="likeBtn"></button>
          <button id="nopeBtn"></button>
          <button id="superLikeBtn"></button>
          <div id="matchToast" aria-live="assertive"></div>
        </main>
      </body>
    </html>`;

  const dom = new JSDOM(html, {
    url: "http://localhost",
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
  });

  dom.window.__APP_DISABLE_AUTO_BOOT = true;
  const script = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  dom.window.eval(script);

  return {
    dom,
    document: dom.window.document,
    window: dom.window,
  };
}

function createNowSequence(start = 1_700_000_000_000, step = 1) {
  let value = start;
  return () => {
    const now = value;
    value += step;
    return now;
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

function withSortPassthrough(fn, win) {
  const originalSort = Array.prototype.sort;
  const originalWindowSort = win?.Array?.prototype.sort;
  Array.prototype.sort = function sortPassthrough() {
    return this;
  };
  if (win?.Array?.prototype) {
    win.Array.prototype.sort = function sortPassthrough() {
      return this;
    };
  }

  try {
    return fn();
  } finally {
    Array.prototype.sort = originalSort;
    if (win?.Array?.prototype) {
      win.Array.prototype.sort = originalWindowSort;
    }
  }
}

function createAppWithOptions(options = {}) {
  const { dom } = setupDom();
  const hooks = dom.window.__APP_TEST_HOOKS;
  const app = hooks.createTinderApp({
    window: dom.window,
    document: dom.window.document,
    now: options.now || (() => 1_700_000_000_000),
    setTimeout: options.setTimeout,
    clearTimeout: options.clearTimeout,
    setInterval: options.setInterval || (() => 1),
    clearInterval: options.clearInterval || (() => {}),
    fetch: options.fetch || (() => {
      throw new Error("no fetch");
    }),
    math: options.math || {
      random() {
        return 0.4;
      },
    },
    apiBase: options.apiBase || "http://localhost:3000",
  });

  return {
    dom,
    window: dom.window,
    document: dom.window.document,
    app,
  };
}

function createProfile(overrides = {}) {
  return {
    id: "p1",
    name: "Alex",
    age: 20,
    city: "Brooklyn",
    title: "Engineer",
    bio: "hello",
    tags: ["Coffee"],
    photos: ["a.jpg", "b.jpg", "c.jpg"],
    ...overrides,
  };
}

describe("frontend partition tests", () => {
  it("renders on boot, rerenders on reset, and shows an empty deck when profiles are cleared", () => {
    const { app, document } = createAppWithOptions({
      fetch: async () => ({ json: async () => ({ matches: [] }) }),
      math: { random: () => 0.2 },
      now: createNowSequence(),
      setTimeout: (cb) => {
        cb();
        return 1;
      },
      clearTimeout: () => {},
    });

    const deck = document.getElementById("deck");
    expect(deck.children.length).toBe(12);
    expect(deck.children[0].classList.contains("card")).toBe(true);
    expect(deck.children[0].getAttribute("data-photos")).toBeTruthy();

    const previousOrder = Array.from(deck.children).map((card) => card.getAttribute("data-profile-id"));
    app.resetDeck();
    const nextOrder = Array.from(deck.children).map((card) => card.getAttribute("data-profile-id"));

    expect(nextOrder).not.toEqual(previousOrder);
    expect(deck.children.length).toBe(12);

    app.setProfiles([]);
    expect(deck.children).toHaveLength(0);
    app.cleanup();
  });

  it("covers generator partitions for count, age bounds, photo counts, and tag de-duplication", () => {
    const makeGeneratedProfile = (math) => {
      const { app, window } = createAppWithOptions({
        math,
        fetch: async () => ({ json: async () => ({ matches: [] }) }),
        setTimeout: (cb) => {
          cb();
          return 1;
        },
        clearTimeout: () => {},
      });

      math.reset?.();
      const generated = withSortPassthrough(() => app.generateProfiles(1)[0], window);
      app.cleanup();
      return generated;
    };

    const { app, window } = createAppWithOptions({
      fetch: async () => ({ json: async () => ({ matches: [] }) }),
      setTimeout: (cb) => {
        cb();
        return 1;
      },
      clearTimeout: () => {},
    });

    expect(withSortPassthrough(() => app.generateProfiles(0), window)).toEqual([]);

    const minCase = makeGeneratedProfile({ random: () => 0 });
    expect(minCase.id).toContain("p_0_");
    expect(minCase.age).toBe(18);
    expect(minCase.photos).toHaveLength(2);
    expect(new Set(minCase.tags).size).toBeLessThan(4);

    const midPhotoCase = makeGeneratedProfile({ random: () => 0.34 });
    expect(midPhotoCase.photos).toHaveLength(3);

    const upperAgeCase = makeGeneratedProfile({ random: () => 0.999 });
    expect(upperAgeCase.age).toBe(39);
    expect(upperAgeCase.photos).toHaveLength(4);

    let tagIdx = 0;
    const maxTagCase = makeGeneratedProfile({
      reset() {
        tagIdx = 0;
      },
      random() {
        const values = [0.99, 0, 0.5, 0, 0, 0, 0, 0.25, 0.5, 0.75];
        const value = values[tagIdx];
        tagIdx += 1;
        return value ?? 0;
      },
    });
    expect(new Set(maxTagCase.tags).size).toBe(4);

    app.cleanup();
  });

  it("snaps back without deciding when swipe is below or exactly at threshold boundaries", async () => {
    const fetchCalls = [];
    const { app, document } = createAppWithOptions({
      math: { random: () => 0.2 },
      fetch: async (url, opts) => {
        fetchCalls.push({ url, opts });
        return { json: async () => ({ matched: false }) };
      },
      now: createNowSequence(1_000, 400),
      setTimeout: () => 1,
      clearTimeout: () => {},
      setInterval: () => 2,
      clearInterval: () => {},
    });

    const interactions = app.interactions;
    const deck = document.getElementById("deck");
    const top = deck.lastElementChild;
    const topImage = top.querySelector("img");

    interactions.onPointerDown({ target: topImage, clientX: 0, clientY: 0, pointerId: 1 });
    interactions.onPointerMove({ clientX: 90, clientY: 0 });
    interactions.onPointerUp();
    await flushMicrotasks();

    expect(fetchCalls).toHaveLength(0);
    expect(deck.lastElementChild).toBe(top);
    expect(top.style.transition).toBe("transform 220ms ease");
    expect(top.style.transform).toBe("translate(0px, 0px) rotate(0deg)");

    interactions.onPointerDown({ target: topImage, clientX: 0, clientY: 0, pointerId: 2 });
    interactions.onPointerMove({ clientX: 0, clientY: -90 });
    interactions.onPointerUp();
    await flushMicrotasks();

    expect(fetchCalls).toHaveLength(0);
    expect(deck.lastElementChild).toBe(top);
    app.cleanup();
  });

  it("maps swipe partitions to like, nope, superlike, and horizontal precedence on diagonals", async () => {
    const calls = [];
    const timeoutCalls = [];
    const { app, document } = createAppWithOptions({
      math: { random: () => 0.2 },
      fetch: async (_url, opts) => {
        calls.push(JSON.parse(opts.body).decision);
        return { json: async () => ({ matched: false }) };
      },
      setTimeout: (_cb, delay) => {
        timeoutCalls.push(delay);
        return 1;
      },
      clearTimeout: () => {},
      setInterval: () => 2,
      clearInterval: () => {},
      now: createNowSequence(1_000_000, 1_000),
    });

    const interactions = app.interactions;
    const deck = document.getElementById("deck");

    app.setProfiles([createProfile()]);
    let image = deck.lastElementChild.querySelector("img");
    interactions.onPointerDown({ target: image, clientX: 0, clientY: 0, pointerId: 1 });
    interactions.onPointerMove({ clientX: 91, clientY: 0 });
    interactions.onPointerUp();
    await flushMicrotasks();
    expect(calls.pop()).toBe("like");

    app.setProfiles([createProfile()]);
    image = deck.lastElementChild.querySelector("img");
    interactions.onPointerDown({ target: image, clientX: 0, clientY: 0, pointerId: 2 });
    interactions.onPointerMove({ clientX: -91, clientY: 0 });
    interactions.onPointerUp();
    await flushMicrotasks();
    expect(calls.pop()).toBe("nope");

    app.setProfiles([createProfile()]);
    image = deck.lastElementChild.querySelector("img");
    interactions.onPointerDown({ target: image, clientX: 0, clientY: 0, pointerId: 3 });
    interactions.onPointerMove({ clientX: 0, clientY: -91 });
    interactions.onPointerUp();
    await flushMicrotasks();
    expect(calls.pop()).toBe("superlike");

    app.setProfiles([createProfile()]);
    image = deck.lastElementChild.querySelector("img");
    interactions.onPointerDown({ target: image, clientX: 0, clientY: 0, pointerId: 4 });
    interactions.onPointerMove({ clientX: 120, clientY: -150 });
    interactions.onPointerUp();
    await flushMicrotasks();
    expect(calls.pop()).toBe("like");

    expect(calls).toEqual([]);
    expect(timeoutCalls).toContain(260);
    app.cleanup();
  });

  it("ignores pointerdown events that do not start on the top card", async () => {
    const fetchCalls = [];
    const { app, document } = createAppWithOptions({
      math: { random: () => 0.2 },
      fetch: async (url, opts) => {
        fetchCalls.push({ url, opts });
        return { json: async () => ({ matched: false }) };
      },
      now: createNowSequence(1_000, 400),
      setTimeout: () => 1,
      clearTimeout: () => {},
      setInterval: () => 2,
      clearInterval: () => {},
    });

    const interactions = app.interactions;
    const deck = document.getElementById("deck");
    const top = deck.lastElementChild;
    const outside = document.createElement("div");
    document.body.appendChild(outside);

    interactions.onPointerDown({ target: outside, clientX: 0, clientY: 0, pointerId: 1 });
    interactions.onPointerMove({ clientX: 200, clientY: 0 });
    interactions.onPointerUp();
    await flushMicrotasks();

    expect(fetchCalls).toHaveLength(0);
    expect(deck.lastElementChild).toBe(top);
    app.cleanup();
  });

  it("advances photos only for double-taps within 320ms and wraps from last back to first", () => {
    const values = [1000, 1319, 2000, 2320, 2600, 2919, 3200, 3519];
    let idx = 0;
    const { app, document } = createAppWithOptions({
      math: { random: () => 0.2 },
      now: () => values[idx++] ?? values[values.length - 1] + 400,
      fetch: async () => ({ json: async () => ({ matched: false }) }),
      setTimeout: (cb) => {
        cb();
        return 1;
      },
      clearTimeout: () => {},
      setInterval: () => 2,
      clearInterval: () => {},
    });

    idx = 0;
    app.setProfiles([createProfile()]);

    const card = document.querySelector(".card");
    const img = card.querySelector("img");
    const photos = JSON.parse(card.getAttribute("data-photos"));

    app.interactions.onPointerDown({ target: img, clientX: 1, clientY: 1, pointerId: 1 });
    app.interactions.onPointerDown({ target: img, clientX: 1, clientY: 1, pointerId: 2 });
    expect(img.src).toBe(`http://localhost/${photos[1]}`);

    app.interactions.onPointerDown({ target: img, clientX: 1, clientY: 1, pointerId: 3 });
    app.interactions.onPointerDown({ target: img, clientX: 1, clientY: 1, pointerId: 4 });
    expect(img.src).toBe(`http://localhost/${photos[1]}`);

    app.interactions.onPointerDown({ target: img, clientX: 1, clientY: 1, pointerId: 5 });
    app.interactions.onPointerDown({ target: img, clientX: 1, clientY: 1, pointerId: 6 });
    expect(img.src).toBe(`http://localhost/${photos[2]}`);

    app.interactions.onPointerDown({ target: img, clientX: 1, clientY: 1, pointerId: 7 });
    app.interactions.onPointerDown({ target: img, clientX: 1, clientY: 1, pointerId: 8 });
    expect(img.src).toBe(`http://localhost/${photos[0]}`);

    app.cleanup();
  });

  it("is robust when nextPhoto sees missing img, missing data, invalid JSON, or an empty array", () => {
    const timeoutCalls = [];
    const { app, document } = createAppWithOptions({
      math: { random: () => 0.2 },
      fetch: async () => ({ json: async () => ({ matched: false }) }),
      setTimeout: (cb, delay) => {
        timeoutCalls.push(delay);
        cb();
        return 1;
      },
      clearTimeout: () => {},
      setInterval: () => 2,
      clearInterval: () => {},
    });

    const missingImg = document.createElement("article");
    missingImg.className = "card";
    missingImg.innerHTML = "<div></div>";
    document.getElementById("deck").appendChild(missingImg);
    expect(() => app.interactions.nextPhoto(missingImg)).not.toThrow();

    const missingData = document.createElement("article");
    missingData.className = "card";
    missingData.innerHTML = "<img src='http://localhost/a.jpg'>";
    document.getElementById("deck").appendChild(missingData);
    expect(() => app.interactions.nextPhoto(missingData)).not.toThrow();

    missingData.setAttribute("data-photos", JSON.stringify([]));
    expect(() => app.interactions.nextPhoto(missingData)).not.toThrow();

    missingData.setAttribute("data-photo-idx", "0");
    missingData.setAttribute("data-photos", "[invalid");
    expect(() => app.interactions.nextPhoto(missingData)).not.toThrow();

    missingData.setAttribute("data-photos", JSON.stringify(["https://example/a.jpg", "https://example/b.jpg"]));
    expect(() => app.interactions.nextPhoto(missingData)).not.toThrow();
    expect(timeoutCalls).not.toContain(260);
    app.cleanup();
  });

  it("removes a card on decision even when the backend is offline", async () => {
    const setTimeoutCalls = [];
    const { app, document, window } = createAppWithOptions({
      math: { random: () => 0.2 },
      fetch: async () => {
        throw new Error("offline");
      },
      setTimeout: (cb, delay) => {
        setTimeoutCalls.push(delay);
        cb();
        return 1;
      },
      clearTimeout: () => {},
      setInterval: () => 2,
      clearInterval: () => {},
    });

    const deck = document.getElementById("deck");
    expect(deck.children.length).toBe(12);

    document.getElementById("likeBtn").dispatchEvent(new window.MouseEvent("click"));
    await flushMicrotasks();

    expect(deck.children.length).toBeLessThan(12);
    expect(setTimeoutCalls).toContain(260);
    app.cleanup();
  });

  it("does nothing when decision buttons are clicked with an empty deck", async () => {
    const fetchCalls = [];
    const { app, document, window } = createAppWithOptions({
      math: { random: () => 0.2 },
      fetch: async (url, opts) => {
        fetchCalls.push({ url, opts });
        return { json: async () => ({ matched: false }) };
      },
      setTimeout: (cb) => {
        cb();
        return 1;
      },
      clearTimeout: () => {},
      setInterval: () => 2,
      clearInterval: () => {},
    });

    app.setProfiles([]);
    document.getElementById("likeBtn").dispatchEvent(new window.MouseEvent("click"));
    document.getElementById("nopeBtn").dispatchEvent(new window.MouseEvent("click"));
    document.getElementById("superLikeBtn").dispatchEvent(new window.MouseEvent("click"));
    await flushMicrotasks();

    expect(fetchCalls).toHaveLength(0);
    expect(document.getElementById("deck").children).toHaveLength(0);
    app.cleanup();
  });

  it("shows a toast only for matched likes and tolerates a missing toast element", async () => {
    const { app, document } = createAppWithOptions({
      math: { random: () => 0.2 },
      fetch: async (_url, opts) => {
        const body = JSON.parse(opts.body);
        return {
          json: async () => ({ matched: body.profileId === "p2" }),
        };
      },
      setTimeout: (cb) => {
        cb();
        return 1;
      },
      clearTimeout: () => {},
      setInterval: () => 2,
      clearInterval: () => {},
    });

    const toast = document.getElementById("matchToast");

    app.setProfiles([createProfile()]);
    app.interactions.animateDecision(document.querySelector(".card"), "like");
    await flushMicrotasks();
    expect(toast.textContent).toBe("");

    app.setProfiles([createProfile({ id: "p2", name: "Sam" })]);
    app.interactions.animateDecision(document.querySelector(".card"), "like");
    await flushMicrotasks();
    expect(toast.textContent).toBe("🔥 It's a Match with Sam!");

    toast.remove();
    app.setProfiles([createProfile({ id: "p3", name: null })]);
    expect(() => app.interactions.animateDecision(document.querySelector(".card"), "superlike")).not.toThrow();
    await flushMicrotasks();

    app.cleanup();
  });

  it("stages poll-driven incoming toasts for zero, one, and multiple unseen matches", async () => {
    const timeoutCalls = [];
    const pollResponses = [
      { matches: [] },
      { matches: [{ profile: { name: "Alex" } }] },
      { matches: [{ profile: { name: "Sam" } }, { profile: { name: null } }] },
    ];

    const { app, document } = createAppWithOptions({
      math: { random: () => 0.2 },
      fetch: async () => ({
        json: async () => pollResponses.shift() ?? { matches: [] },
      }),
      setTimeout: (cb, delay) => {
        timeoutCalls.push(delay);
        cb();
        return 1;
      },
      clearTimeout: () => {},
      setInterval: () => 2,
      clearInterval: () => {},
    });

    const toast = document.getElementById("matchToast");

    await app.pollForMatches();
    expect(timeoutCalls).toEqual([]);
    expect(toast.textContent).toBe("");

    await app.pollForMatches();
    expect(timeoutCalls).toContain(0);
    expect(timeoutCalls).toContain(2200);
    expect(toast.textContent).toBe("🔥 It's a Match with Alex!");

    await app.pollForMatches();
    expect(timeoutCalls).toContain(2400);
    expect(toast.textContent).toBe("🔥 It's a Match!");

    app.cleanup();
  });
});
