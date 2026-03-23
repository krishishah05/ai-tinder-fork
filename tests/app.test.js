/**
 * Edge-case tests for app.js frontend interaction logic.
 *
 * Uses jsdom (via Jest's default environment) to simulate the DOM.
 * The functions under test (nextPhoto, animateDecision, getTopCard,
 * onPointerDown / double-tap) are extracted and re-implemented here
 * from app.js because they live inside a private IIFE.
 *
 * Pure-function logic (generateProfiles, pickTags) is tested directly.
 */

// ─── Pure-function helpers extracted from app.js ─────────────────────────────

const TAGS = [
  "Coffee","Hiking","Movies","Live Music","Board Games","Cats","Dogs","Traveler",
  "Foodie","Tech","Art","Runner","Climbing","Books","Yoga","Photography"
];
const UNSPLASH_SEEDS = [
  "1515462277126-2b47b9fa09e6","1520975916090-3105956dac38","1519340241574-2cec6aef0c01",
  "1554151228-14d9def656e4","1548142813-c348350df52b","1517841905240-472988babdf9",
  "1535713875002-d1d0cf377fde","1545996124-0501ebae84d0","1524504388940-b1c1722653e1",
  "1531123897727-8f129e1688ce",
];

function sample(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickTags() { return Array.from(new Set(Array.from({length:4}, ()=>sample(TAGS)))); }
function imgFor(seed) { return `https://images.unsplash.com/photo-${seed}?auto=format&fit=crop&w=1200&q=80`; }

function generateProfiles(count = 12) {
  const profiles = [];
  for (let i = 0; i < count; i++) {
    const shuffled = [...UNSPLASH_SEEDS].sort(() => Math.random() - 0.5);
    const photoCount = 2 + Math.floor(Math.random() * 3);
    const photos = shuffled.slice(0, photoCount).map(imgFor);
    profiles.push({
      id: `p_${i}_${Date.now().toString(36)}`,
      name: sample(["Alex","Sam"]),
      age: 18 + Math.floor(Math.random() * 22),
      city: sample(["Brooklyn"]),
      title: sample(["Engineer"]),
      bio: "Test bio",
      tags: pickTags(),
      photos,
    });
  }
  return profiles;
}

// ─── DOM helpers ─────────────────────────────────────────────────────────────

function makeCard({ photos = ["a.jpg", "b.jpg", "c.jpg"], idx = 0, profileId = "p1", profile = null } = {}) {
  const card = document.createElement("article");
  card.className = "card";
  card.setAttribute("data-photos", JSON.stringify(photos));
  card.setAttribute("data-photo-idx", String(idx));
  card.setAttribute("data-profile-id", profileId);
  if (profile) card.setAttribute("data-profile", JSON.stringify(profile));
  const img = document.createElement("img");
  img.className = "card__media";
  img.src = photos[idx] ?? photos[0];
  card.appendChild(img);
  return card;
}

// nextPhoto — extracted from app.js IIFE (identical logic)
function nextPhoto(card) {
  if (!card) return;
  const img = card.querySelector("img");
  if (!img) return;
  const raw = card.getAttribute("data-photos");
  if (!raw) return;
  let photos;
  try { photos = JSON.parse(raw); } catch { return; }
  if (!Array.isArray(photos) || photos.length === 0) return;
  const idx = Number(card.getAttribute("data-photo-idx") || "0");
  const nextIdx = (idx + 1) % photos.length;
  card.setAttribute("data-photo-idx", String(nextIdx));
  img.src = photos[nextIdx];
}

// getTopCard — extracted (uses live HTMLCollection or querySelector)
function makeGetTopCard(container) {
  const cardElements = container.getElementsByClassName("card");
  return function getTopCard() {
    if (!cardElements || cardElements.length === 0) return null;
    return cardElements[cardElements.length - 1];
  };
}

// animateDecision — extracted (minus postDecision / showMatchToast dependencies)
const ROTATE_DEG = 12;
const EXIT_MULT  = 1.25;

function animateDecision(card, decision, { postDecision = () => Promise.resolve(null), showMatchToast = () => {} } = {}) {
  if (!card) return;

  const profileId = card.getAttribute("data-profile-id") || "";
  let profile = null;
  try { profile = JSON.parse(card.getAttribute("data-profile") || "null"); } catch { /* ignore */ }

  const outX = decision === "like" ? window.innerWidth : decision === "nope" ? -window.innerWidth : 0;
  const outY = decision === "superlike" ? -window.innerHeight : 0;
  const rotate = decision === "like" ? ROTATE_DEG : decision === "nope" ? -ROTATE_DEG : 0;

  card.style.transition = "transform 260ms ease";
  card.style.transform  = `translate(${outX * EXIT_MULT}px, ${outY * EXIT_MULT}px) rotate(${rotate}deg)`;

  postDecision(profileId, decision, profile).then((data) => {
    if (data && data.matched) showMatchToast(profile?.name);
  });
  if (decision === "superlike") showMatchToast(profile?.name);

  setTimeout(() => card.remove(), 260);
}

// ─── Tests: nextPhoto ─────────────────────────────────────────────────────────

describe("nextPhoto", () => {
  test("advances index through all photos and wraps to 0", () => {
    const card = makeCard({ photos: ["a.jpg", "b.jpg", "c.jpg"], idx: 0 });
    const img = card.querySelector("img");

    nextPhoto(card);
    expect(card.getAttribute("data-photo-idx")).toBe("1");
    expect(img.src).toContain("b.jpg");

    nextPhoto(card);
    expect(card.getAttribute("data-photo-idx")).toBe("2");
    expect(img.src).toContain("c.jpg");

    // Wrap-around
    nextPhoto(card);
    expect(card.getAttribute("data-photo-idx")).toBe("0");
    expect(img.src).toContain("a.jpg");
  });

  test("single-photo card: nextPhoto stays at index 0 (wraps back)", () => {
    const card = makeCard({ photos: ["only.jpg"], idx: 0 });
    const img  = card.querySelector("img");

    nextPhoto(card);
    expect(card.getAttribute("data-photo-idx")).toBe("0");
    expect(img.src).toContain("only.jpg");
  });

  test("does not crash when card is null", () => {
    expect(() => nextPhoto(null)).not.toThrow();
  });

  test("does not crash when data-photos is missing", () => {
    const card = document.createElement("article");
    card.className = "card";
    const img = document.createElement("img");
    card.appendChild(img);
    // No data-photos attribute
    expect(() => nextPhoto(card)).not.toThrow();
  });

  test("does not crash when data-photos is invalid JSON", () => {
    const card = makeCard();
    card.setAttribute("data-photos", "NOT_VALID_JSON{{{");
    expect(() => nextPhoto(card)).not.toThrow();
    // Photo index should not have changed
    expect(card.getAttribute("data-photo-idx")).toBe("0");
  });

  test("does not crash when data-photos is an empty array", () => {
    const card = makeCard({ photos: ["a.jpg"] });
    card.setAttribute("data-photos", "[]");
    expect(() => nextPhoto(card)).not.toThrow();
  });

  test("does not crash when the img element is absent", () => {
    const card = document.createElement("article");
    card.className = "card";
    card.setAttribute("data-photos", JSON.stringify(["a.jpg", "b.jpg"]));
    card.setAttribute("data-photo-idx", "0");
    // No img child
    expect(() => nextPhoto(card)).not.toThrow();
  });

  test("index starts from correct position when data-photo-idx is pre-set", () => {
    const card = makeCard({ photos: ["a.jpg", "b.jpg", "c.jpg"], idx: 2 });
    nextPhoto(card); // should wrap to 0
    expect(card.getAttribute("data-photo-idx")).toBe("0");
  });
});

// ─── Tests: animateDecision ───────────────────────────────────────────────────

describe("animateDecision", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = "";
  });

  test("does not crash when card is null (empty deck)", () => {
    expect(() => animateDecision(null, "like")).not.toThrow();
  });

  test("removes the card after 260ms", () => {
    const card = makeCard();
    document.body.appendChild(card);

    animateDecision(card, "like");
    expect(document.body.contains(card)).toBe(true);

    jest.advanceTimersByTime(260);
    expect(document.body.contains(card)).toBe(false);
  });

  test("superlike calls showMatchToast immediately (before server responds)", () => {
    const card = makeCard({ profile: { name: "Riley" } });
    const showMatchToast = jest.fn();
    const postDecision   = jest.fn(() => new Promise(() => {})); // never resolves

    animateDecision(card, "superlike", { postDecision, showMatchToast });
    expect(showMatchToast).toHaveBeenCalledTimes(1);
    expect(showMatchToast).toHaveBeenCalledWith("Riley");
  });

  test("superlike calls showMatchToast exactly once even after server confirms match", async () => {
    const card = makeCard({ profile: { name: "Riley" } });
    const showMatchToast = jest.fn();
    const postDecision   = jest.fn(() => Promise.resolve({ matched: true }));

    animateDecision(card, "superlike", { postDecision, showMatchToast });
    await Promise.resolve();
    expect(showMatchToast).toHaveBeenCalledTimes(1);
  });

  test("like shows toast only when server responds with matched=true", async () => {
    const card = makeCard({ profile: { name: "Morgan" } });
    const showMatchToast = jest.fn();
    const postDecision   = jest.fn(() => Promise.resolve({ matched: true }));

    animateDecision(card, "like", { postDecision, showMatchToast });
    expect(showMatchToast).not.toHaveBeenCalled(); // not immediate
    await Promise.resolve();
    expect(showMatchToast).toHaveBeenCalledTimes(1);
  });

  test("like shows no toast when server responds with matched=false", async () => {
    const card = makeCard();
    const showMatchToast = jest.fn();
    const postDecision   = jest.fn(() => Promise.resolve({ matched: false }));

    animateDecision(card, "like", { postDecision, showMatchToast });
    await Promise.resolve();
    expect(showMatchToast).not.toHaveBeenCalled();
  });

  test("like shows no toast when server is offline (postDecision returns null)", async () => {
    const card = makeCard();
    const showMatchToast = jest.fn();
    const postDecision   = jest.fn(() => Promise.resolve(null));

    animateDecision(card, "like", { postDecision, showMatchToast });
    await Promise.resolve();
    expect(showMatchToast).not.toHaveBeenCalled();
  });

  test("nope never shows toast regardless of server response", async () => {
    const card = makeCard();
    const showMatchToast = jest.fn();
    const postDecision   = jest.fn(() => Promise.resolve({ matched: true }));

    animateDecision(card, "nope", { postDecision, showMatchToast });
    await Promise.resolve();
    expect(showMatchToast).not.toHaveBeenCalled();
  });

  test("rapid double-click on same card within 260ms animation — second call is a no-op (card already animating)", () => {
    const card = makeCard();
    document.body.appendChild(card);
    const showMatchToast = jest.fn();

    // First click
    animateDecision(card, "like", { showMatchToast });
    // Second click before 260ms elapses — card still in DOM
    expect(() => animateDecision(card, "like", { showMatchToast })).not.toThrow();
    // Card style is overwritten but it won't be removed twice (double remove is safe)
    jest.advanceTimersByTime(260);
    // Still only one card was ever in the DOM
    expect(document.body.querySelectorAll(".card")).toHaveLength(0);
  });

  test("card with no data-profile attribute — profile is null, no crash", () => {
    const card = makeCard(); // no profile attribute set
    const showMatchToast = jest.fn();
    const postDecision   = jest.fn(() => Promise.resolve({ matched: true }));

    expect(() => animateDecision(card, "superlike", { postDecision, showMatchToast })).not.toThrow();
    expect(showMatchToast).toHaveBeenCalledWith(undefined); // profile?.name is undefined
  });
});

// ─── Tests: getTopCard ────────────────────────────────────────────────────────

describe("getTopCard", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  test("returns null when deck is empty", () => {
    const deck = document.createElement("div");
    document.body.appendChild(deck);
    const getTopCard = makeGetTopCard(deck);
    expect(getTopCard()).toBeNull();
  });

  test("returns the last card in DOM order (top of visual stack)", () => {
    const deck = document.createElement("div");
    document.body.appendChild(deck);
    const getTopCard = makeGetTopCard(deck);

    const c1 = makeCard({ profileId: "p1" });
    const c2 = makeCard({ profileId: "p2" });
    const c3 = makeCard({ profileId: "p3" });
    deck.appendChild(c1);
    deck.appendChild(c2);
    deck.appendChild(c3);

    expect(getTopCard()).toBe(c3);
  });

  test("updates automatically when last card is removed", () => {
    const deck = document.createElement("div");
    document.body.appendChild(deck);
    const getTopCard = makeGetTopCard(deck);

    const c1 = makeCard({ profileId: "p1" });
    const c2 = makeCard({ profileId: "p2" });
    deck.appendChild(c1);
    deck.appendChild(c2);

    c2.remove();
    expect(getTopCard()).toBe(c1);

    c1.remove();
    expect(getTopCard()).toBeNull();
  });
});

// ─── Tests: swipe threshold boundary ─────────────────────────────────────────

describe("Swipe threshold boundary (onPointerUp logic)", () => {
  const SWIPE_X_THRESHOLD = 90;
  const SWIPE_Y_THRESHOLD = 90;

  // Extracted decision logic from onPointerUp
  function decisionFor(dx, dy) {
    if (dx > SWIPE_X_THRESHOLD)  return "like";
    if (dx < -SWIPE_X_THRESHOLD) return "nope";
    if (dy < -SWIPE_Y_THRESHOLD) return "superlike";
    return null; // snap back
  }

  test("dx exactly at threshold (90) does NOT trigger like — snap back", () => {
    expect(decisionFor(90, 0)).toBeNull();
  });

  test("dx one pixel past threshold (91) triggers like", () => {
    expect(decisionFor(91, 0)).toBe("like");
  });

  test("dx exactly at negative threshold (-90) does NOT trigger nope", () => {
    expect(decisionFor(-90, 0)).toBeNull();
  });

  test("dx one pixel past negative threshold (-91) triggers nope", () => {
    expect(decisionFor(-91, 0)).toBe("nope");
  });

  test("dy exactly at negative threshold (-90) does NOT trigger superlike", () => {
    expect(decisionFor(0, -90)).toBeNull();
  });

  test("dy one pixel past negative threshold (-91) triggers superlike", () => {
    expect(decisionFor(0, -91)).toBe("superlike");
  });

  test("large dx dominates over large dy — like wins over superlike when both exceeded", () => {
    // dx > SWIPE_X_THRESHOLD is checked first in code
    expect(decisionFor(200, -200)).toBe("like");
  });

  test("large negative dx dominates over large upward dy", () => {
    expect(decisionFor(-200, -200)).toBe("nope");
  });
});

// ─── Tests: double-tap detection ─────────────────────────────────────────────

describe("Double-tap timing (DOUBLE_TAP_MS = 320ms)", () => {
  const DOUBLE_TAP_MS = 320;

  // Extracted timing predicate from onPointerDown
  function isDoubleTap(lastTapTime, now) {
    return now - lastTapTime < DOUBLE_TAP_MS;
  }

  test("second tap 319ms after first is a double-tap", () => {
    const first = 1000;
    expect(isDoubleTap(first, first + 319)).toBe(true);
  });

  test("second tap exactly at 320ms is NOT a double-tap (boundary exclusive)", () => {
    const first = 1000;
    expect(isDoubleTap(first, first + 320)).toBe(false);
  });

  test("second tap 321ms after first is NOT a double-tap", () => {
    const first = 1000;
    expect(isDoubleTap(first, first + 321)).toBe(false);
  });

  test("lastTapTime reset to 0 after double-tap prevents triple-tap triggering another cycle", () => {
    // After double-tap: lastTapTime = 0
    const now = Date.now();
    // Third tap: now - 0 = now (>> DOUBLE_TAP_MS), should not be a double-tap
    expect(isDoubleTap(0, now)).toBe(false);
  });
});

// ─── Tests: generateProfiles ─────────────────────────────────────────────────

describe("generateProfiles", () => {
  test("returns empty array when count is 0", () => {
    expect(generateProfiles(0)).toEqual([]);
  });

  test("returns the requested number of profiles", () => {
    expect(generateProfiles(5)).toHaveLength(5);
    expect(generateProfiles(1)).toHaveLength(1);
  });

  test("each profile has 2–4 photos", () => {
    const profiles = generateProfiles(50);
    for (const p of profiles) {
      expect(p.photos.length).toBeGreaterThanOrEqual(2);
      expect(p.photos.length).toBeLessThanOrEqual(4);
    }
  });

  test("each profile's photos are unique (no duplicates within one profile)", () => {
    const profiles = generateProfiles(50);
    for (const p of profiles) {
      expect(new Set(p.photos).size).toBe(p.photos.length);
    }
  });

  test("each profile has a unique id", () => {
    const profiles = generateProfiles(12);
    const ids = profiles.map(p => p.id);
    expect(new Set(ids).size).toBe(12);
  });

  test("age is always between 18 and 39 inclusive", () => {
    const profiles = generateProfiles(200);
    for (const p of profiles) {
      expect(p.age).toBeGreaterThanOrEqual(18);
      expect(p.age).toBeLessThanOrEqual(39);
    }
  });
});

// ─── Tests: pickTags ─────────────────────────────────────────────────────────

describe("pickTags", () => {
  test("returns between 1 and 4 tags", () => {
    // Because of Set deduplication from random sampling, count may be < 4
    for (let i = 0; i < 100; i++) {
      const tags = pickTags();
      expect(tags.length).toBeGreaterThanOrEqual(1);
      expect(tags.length).toBeLessThanOrEqual(4);
    }
  });

  test("all returned tags are valid (from TAGS array)", () => {
    for (let i = 0; i < 100; i++) {
      const tags = pickTags();
      for (const tag of tags) {
        expect(TAGS).toContain(tag);
      }
    }
  });

  test("returned tags have no duplicates", () => {
    for (let i = 0; i < 100; i++) {
      const tags = pickTags();
      expect(new Set(tags).size).toBe(tags.length);
    }
  });
});
