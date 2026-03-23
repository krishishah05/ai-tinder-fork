// test/app.test.js
// White-box tests for app.js
//
// Strategy: inputs are chosen by reading the source and hitting every branch —
// especially the exact boundary of each comparison operator.
//
// Loading strategy: app.js is plain (non-module) browser JS.  We use JSDOM
// with runScripts:'dangerously' to execute it exactly as a browser would, so
// top-level function declarations become properties of window.  IIFE-scoped
// functions (nextPhoto, animateDecision, onPointerUp …) are tested indirectly
// by dispatching the DOM events they are bound to.

const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const APP_CODE = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");

// Minimal HTML that mirrors index.html (only the element IDs that app.js queries)
const BASE_HTML = `<!DOCTYPE html>
<html><body>
  <main id="deck"></main>
  <button id="shuffleBtn"></button>
  <button id="likeBtn"></button>
  <button id="nopeBtn"></button>
  <button id="superLikeBtn"></button>
  <div id="matchToast"></div>
</body></html>`;

/**
 * Create a fresh JSDOM window with app.js already loaded.
 * fetch is mocked so network calls never leave the process.
 */
function createWindow(fetchImpl) {
  const dom = new JSDOM(BASE_HTML, {
    runScripts: "dangerously",
    url: "http://localhost:3000",
  });
  const win = dom.window;

  // Provide a mock fetch before running app.js so postDecision / pollForMatches
  // don't throw "fetch is not defined".
  win.fetch = fetchImpl || jest.fn().mockResolvedValue({
    json: () => Promise.resolve({ matched: false, stats: {} }),
  });

  // Inject app.js as a <script> element so it runs in the window's JS context.
  // This makes top-level function declarations (generateProfiles, showMatchToast,
  // etc.) available as win.generateProfiles, win.showMatchToast, etc.
  const script = win.document.createElement("script");
  script.textContent = APP_CODE;
  win.document.body.appendChild(script);

  return win;
}

/**
 * Helper: fire a pointer event on a target element in a given window.
 */
function firePointer(win, type, target, clientX = 0, clientY = 0) {
  const ev = new win.PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    clientX,
    clientY,
  });
  target.dispatchEvent(ev);
}

/**
 * Helper: return the current top card (last in DOM order) from a window.
 * Mirrors getTopCard() in app.js: cardElements[cardElements.length - 1]
 */
function topCard(win) {
  const cards = win.document.getElementsByClassName("card");
  return cards.length > 0 ? cards[cards.length - 1] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// generateProfiles
//
// Source line 72-91:
//   photoCount = 2 + Math.floor(Math.random() * 3)   → 2, 3, or 4
//   age        = 18 + Math.floor(Math.random() * 22)  → 18–39
// ─────────────────────────────────────────────────────────────────────────────
describe("generateProfiles", () => {
  let win;
  beforeAll(() => { win = createWindow(); });

  test("returns exactly the requested number of profiles", () => {
    expect(win.generateProfiles(1)).toHaveLength(1);
    expect(win.generateProfiles(5)).toHaveLength(5);
    expect(win.generateProfiles(12)).toHaveLength(12);
  });

  test("each profile has the required fields", () => {
    const [p] = win.generateProfiles(1);
    expect(p).toMatchObject({
      id: expect.stringMatching(/^p_/),
      name: expect.any(String),
      age: expect.any(Number),
      city: expect.any(String),
      title: expect.any(String),
      bio: expect.any(String),
      tags: expect.any(Array),
      photos: expect.any(Array),
    });
  });

  test("photo count is always 2, 3, or 4 (line 77: 2 + floor(random*3))", () => {
    // Run many profiles so all RNG outcomes are likely exercised.
    const profiles = win.generateProfiles(50);
    profiles.forEach((p) => {
      expect(p.photos.length).toBeGreaterThanOrEqual(2);
      expect(p.photos.length).toBeLessThanOrEqual(4);
    });
  });

  test("age is always in range 18–39 (line 82: 18 + floor(random*22))", () => {
    const profiles = win.generateProfiles(50);
    profiles.forEach((p) => {
      expect(p.age).toBeGreaterThanOrEqual(18);
      expect(p.age).toBeLessThanOrEqual(39);
    });
  });

  test("generateProfiles(0) returns an empty array", () => {
    expect(win.generateProfiles(0)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// showMatchToast
//
// Source line 172: if (!toast) return
// Source line 173: name ? `…with ${name}!` : "…It's a Match!"
// Source line 178: setTimeout(…, 2200)
// ─────────────────────────────────────────────────────────────────────────────
describe("showMatchToast", () => {
  let win;
  beforeAll(() => { win = createWindow(); });

  test("does nothing (no throw) when toast element is absent", () => {
    // Remove the toast element to hit the `if (!toast) return` branch.
    const toast = win.document.getElementById("matchToast");
    toast.remove();
    expect(() => win.showMatchToast("Alice")).not.toThrow();
    // Re-add for subsequent tests
    const div = win.document.createElement("div");
    div.id = "matchToast";
    win.document.body.appendChild(div);
  });

  test("includes the name when a name is provided (truthy branch of line 173)", () => {
    win.showMatchToast("Alice");
    const toast = win.document.getElementById("matchToast");
    expect(toast.textContent).toContain("Alice");
  });

  test("uses generic text when name is falsy (falsy branch of line 173)", () => {
    win.showMatchToast(null);
    const toast = win.document.getElementById("matchToast");
    expect(toast.textContent).not.toContain("null");
    expect(toast.textContent).toContain("Match");
  });

  test("adds the visible CSS class", () => {
    win.showMatchToast("Bob");
    const toast = win.document.getElementById("matchToast");
    expect(toast.classList.contains("match-toast--visible")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// nextPhoto  (IIFE-scoped — tested indirectly via double-tap pointer events)
//
// Source line 229: const nextIdx = (idx + 1) % photos.length
//
// We set up a card manually with a known data-photos attribute and trigger
// a double-tap (two pointerdown events within 320 ms) to invoke nextPhoto.
// ─────────────────────────────────────────────────────────────────────────────
describe("nextPhoto (via double-tap)", () => {
  let win, deck;

  beforeEach(() => {
    win = createWindow();
    deck = win.document.getElementById("deck");
  });

  /**
   * Build a card with a controlled photos list and inject it as the top card.
   */
  function makeCard(photos, startIdx = 0) {
    // Remove existing auto-generated cards so our card is the only one.
    deck.innerHTML = "";
    const card = win.document.createElement("article");
    card.className = "card";
    card.setAttribute("data-photos", JSON.stringify(photos));
    card.setAttribute("data-photo-idx", String(startIdx));
    card.setAttribute("data-profile-id", "test_card");
    card.setAttribute("data-profile", "null");

    const img = win.document.createElement("img");
    img.src = photos[startIdx] || "";
    card.appendChild(img);
    deck.appendChild(card);
    return card;
  }

  /**
   * Simulate a double-tap by firing two pointerdown events with a given delay
   * between them.  We fake Date.now so DOUBLE_TAP_MS comparisons are deterministic.
   */
  function doubleTap(card, firstTime, secondTime) {
    const origNow = win.Date.now;
    let callCount = 0;
    win.Date.now = () => {
      callCount++;
      return callCount === 1 ? firstTime : secondTime;
    };
    firePointer(win, "pointerdown", card, 0, 0); // first tap
    firePointer(win, "pointerdown", card, 0, 0); // second tap
    win.Date.now = origNow;
  }

  test("wraps index from last photo back to 0 ((idx+1)%length)", () => {
    const photos = ["a.jpg", "b.jpg", "c.jpg"];
    const card = makeCard(photos, 2); // start at last photo (idx=2)

    doubleTap(card, 1000, 1100); // 100 ms apart → double-tap

    expect(card.getAttribute("data-photo-idx")).toBe("0");
    expect(card.querySelector("img").src).toContain("a.jpg");
  });

  test("advances from index 0 to index 1", () => {
    const photos = ["a.jpg", "b.jpg", "c.jpg"];
    const card = makeCard(photos, 0);

    doubleTap(card, 1000, 1100);

    expect(card.getAttribute("data-photo-idx")).toBe("1");
  });

  test("single-photo card stays at index 0 ((0+1)%1 = 0)", () => {
    const photos = ["only.jpg"];
    const card = makeCard(photos, 0);

    doubleTap(card, 1000, 1100);

    expect(card.getAttribute("data-photo-idx")).toBe("0");
  });

  test("empty photos array → nextPhoto returns early, no crash", () => {
    const card = makeCard(["a.jpg"], 0);
    // Override data-photos with an empty array after card is created
    card.setAttribute("data-photos", "[]");

    expect(() => doubleTap(card, 1000, 1100)).not.toThrow();
  });

  test("invalid JSON in data-photos → nextPhoto returns early, no crash", () => {
    const card = makeCard(["a.jpg"], 0);
    card.setAttribute("data-photos", "NOT_JSON");

    expect(() => doubleTap(card, 1000, 1100)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Double-tap timing boundary
//
// Source line 287: if (now - lastTapTime < DOUBLE_TAP_MS)   DOUBLE_TAP_MS = 320
//
// Critical values (< vs <=):
//   319 ms → IS   < 320 → double-tap fires nextPhoto
//   320 ms → NOT  < 320 → single tap, no nextPhoto
// ─────────────────────────────────────────────────────────────────────────────
describe("double-tap timing boundary (DOUBLE_TAP_MS = 320)", () => {
  let win, card;

  function setup() {
    win = createWindow();
    const photos = ["a.jpg", "b.jpg"];
    const deck = win.document.getElementById("deck");
    deck.innerHTML = "";
    card = win.document.createElement("article");
    card.className = "card";
    card.setAttribute("data-photos", JSON.stringify(photos));
    card.setAttribute("data-photo-idx", "0");
    card.setAttribute("data-profile-id", "t");
    card.setAttribute("data-profile", "null");
    const img = win.document.createElement("img");
    img.src = photos[0];
    card.appendChild(img);
    deck.appendChild(card);
  }

  function tapTwiceWithDelta(delta) {
    const T0 = 10000;
    let call = 0;
    const origNow = win.Date.now;
    win.Date.now = () => { call++; return call === 1 ? T0 : T0 + delta; };
    firePointer(win, "pointerdown", card, 0, 0);
    firePointer(win, "pointerdown", card, 0, 0);
    win.Date.now = origNow;
  }

  test("delta=319 ms → double-tap: photo index advances (319 < 320)", () => {
    setup();
    tapTwiceWithDelta(319);
    expect(card.getAttribute("data-photo-idx")).toBe("1");
  });

  test("delta=320 ms → NOT a double-tap: photo index stays at 0 (320 is not < 320)", () => {
    setup();
    tapTwiceWithDelta(320);
    // With 320 ms gap the second tap is treated as a fresh first tap, so no
    // nextPhoto call fires and the index remains 0.
    expect(card.getAttribute("data-photo-idx")).toBe("0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Swipe gesture thresholds (onPointerUp)
//
// Source line 316: if (dx >  SWIPE_X_THRESHOLD)  → "like"      SWIPE_X_THRESHOLD = 90
// Source line 317: if (dx < -SWIPE_X_THRESHOLD)  → "nope"
// Source line 318: if (dy < -SWIPE_Y_THRESHOLD)  → "superlike" SWIPE_Y_THRESHOLD = 90
//
// For animateDecision the card's transform is set synchronously (before the
// 260 ms timeout that removes it), so we can assert on style immediately.
//
// Exit directions (source line 241-253):
//   like:      outX = +window.innerWidth  → translate(positive X)
//   nope:      outX = -window.innerWidth  → translate(negative X)
//   superlike: outX = 0, outY = -window.innerHeight → translate(0, negative Y)
//   snap-back: transform = "translate(0px, 0px) rotate(0deg)"
// ─────────────────────────────────────────────────────────────────────────────
describe("swipe gesture thresholds", () => {
  let win, card;

  beforeEach(() => {
    win = createWindow();
    // Rely on the deck that resetDeck() already populated.
    card = topCard(win);
  });

  /**
   * Simulate a complete swipe gesture: pointerdown at (0,0), pointermove to
   * (endX, endY), then pointerup.  Returns the card's final transform string.
   */
  function swipe(endX, endY) {
    firePointer(win, "pointerdown", card, 0, 0);
    firePointer(win, "pointermove", card, endX, endY);
    firePointer(win, "pointerup",   card, endX, endY);
    return card.style.transform;
  }

  // ── Right swipe (like) ────────────────────────────────────────────────────

  test("dx=91 → like: card exits with positive X transform (91 > 90)", () => {
    const transform = swipe(91, 0);
    // Exit multiplier is 1.25; window.innerWidth in jsdom defaults to 1024
    expect(transform).toMatch(/translate\(\d+(\.\d+)?px/); // positive X
    const xVal = parseFloat(transform.match(/translate\(([^,]+),/)?.[1]);
    expect(xVal).toBeGreaterThan(0);
  });

  test("dx=90 → snap-back: NOT a like (90 is not > 90 — boundary!)", () => {
    const transform = swipe(90, 0);
    expect(transform).toBe("translate(0px, 0px) rotate(0deg)");
  });

  test("dx=89 → snap-back: clearly below threshold", () => {
    const transform = swipe(89, 0);
    expect(transform).toBe("translate(0px, 0px) rotate(0deg)");
  });

  // ── Left swipe (nope) ─────────────────────────────────────────────────────

  test("dx=-91 → nope: card exits with negative X transform (-91 < -90)", () => {
    const transform = swipe(-91, 0);
    const xVal = parseFloat(transform.match(/translate\(([^,]+),/)?.[1]);
    expect(xVal).toBeLessThan(0);
  });

  test("dx=-90 → snap-back: NOT a nope (-90 is not < -90 — boundary!)", () => {
    const transform = swipe(-90, 0);
    expect(transform).toBe("translate(0px, 0px) rotate(0deg)");
  });

  // ── Up swipe (superlike) ──────────────────────────────────────────────────

  test("dy=-91 → superlike: card exits with negative Y transform (-91 < -90)", () => {
    const transform = swipe(0, -91);
    const yVal = parseFloat(transform.match(/,\s*([^)]+)px\)/)?.[1]);
    expect(yVal).toBeLessThan(0);
  });

  test("dy=-90 → snap-back: NOT a superlike (-90 is not < -90 — boundary!)", () => {
    const transform = swipe(0, -90);
    expect(transform).toBe("translate(0px, 0px) rotate(0deg)");
  });

  // ── No drag ───────────────────────────────────────────────────────────────

  test("dx=0, dy=0 → snap-back (no threshold crossed)", () => {
    const transform = swipe(0, 0);
    expect(transform).toBe("translate(0px, 0px) rotate(0deg)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Card rotation during drag (onPointerMove)
//
// Source line 305: Math.max(-ROTATE_DEG, Math.min(ROTATE_DEG, dx / 18))
//                  ROTATE_DEG = 12
//
// Clamping boundary: dx/18 is clamped to [-12, 12].
//   dx = 18*12 = 216  → rotate exactly  12 (ceiling)
//   dx = 18*13 = 234  → still rotate    12 (clamped)
//   dx = 18*-12 = -216 → rotate exactly -12 (floor)
//   dx = 18*-13 = -234 → still rotate  -12 (clamped)
// ─────────────────────────────────────────────────────────────────────────────
describe("card rotation clamping during drag", () => {
  let win, card;

  beforeEach(() => {
    win = createWindow();
    card = topCard(win);
  });

  function drag(dx) {
    firePointer(win, "pointerdown", card, 0, 0);
    firePointer(win, "pointermove", card, dx, 0);
    return card.style.transform;
  }

  test("dx=18 → rotate(1deg)  (18/18 = 1, within clamp)", () => {
    const t = drag(18);
    expect(t).toContain("rotate(1deg)");
  });

  test("dx=216 → rotate(12deg) exactly (216/18 = 12, hits ceiling)", () => {
    const t = drag(216);
    expect(t).toContain("rotate(12deg)");
  });

  test("dx=234 → rotate(12deg) still (234/18 = 13, clamped to 12)", () => {
    const t = drag(234);
    expect(t).toContain("rotate(12deg)");
  });

  test("dx=-216 → rotate(-12deg) exactly (hits floor)", () => {
    const t = drag(-216);
    expect(t).toContain("rotate(-12deg)");
  });

  test("dx=-234 → rotate(-12deg) still (clamped to -12)", () => {
    const t = drag(-234);
    expect(t).toContain("rotate(-12deg)");
  });
});
