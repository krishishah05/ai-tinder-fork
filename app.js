// app.js
// Plain global JS, no modules.

const API_BASE = "http://localhost:3000";

const TAGS = [
  "Coffee", "Hiking", "Movies", "Live Music", "Board Games", "Cats", "Dogs", "Traveler",
  "Foodie", "Tech", "Art", "Runner", "Climbing", "Books", "Yoga", "Photography"
];
const FIRST_NAMES = [
  "Alex", "Sam", "Jordan", "Taylor", "Casey", "Avery", "Riley", "Morgan", "Quinn", "Cameron",
  "Jamie", "Drew", "Parker", "Reese", "Emerson", "Rowan", "Shawn", "Harper", "Skyler", "Devon"
];
const CITIES = [
  "Brooklyn", "Manhattan", "Queens", "Jersey City", "Hoboken", "Astoria",
  "Williamsburg", "Bushwick", "Harlem", "Lower East Side"
];
const JOBS = [
  "Product Designer", "Software Engineer", "Data Analyst", "Barista", "Teacher",
  "Photographer", "Architect", "Chef", "Nurse", "Marketing Manager", "UX Researcher"
];
const BIOS = [
  "Weekend hikes and weekday lattes.",
  "Dog parent. Amateur chef. Karaoke enthusiast.",
  "Trying every taco in the city — for science.",
  "Bookstore browser and movie quote machine.",
  "Gym sometimes, Netflix always.",
  "Looking for the best slice in town.",
  "Will beat you at Mario Kart.",
  "Currently planning the next trip."
];
const UNSPLASH_SEEDS = [
  "1515462277126-2b47b9fa09e6",
  "1520975916090-3105956dac38",
  "1519340241574-2cec6aef0c01",
  "1554151228-14d9def656e4",
  "1548142813-c348350df52b",
  "1517841905240-472988babdf9",
  "1535713875002-d1d0cf377fde",
  "1545996124-0501ebae84d0",
  "1524504388940-b1c1722653e1",
  "1531123897727-8f129e1688ce",
];

function createTinderApp(options = {}) {
  const win = options.window || window;
  const doc = options.document || win.document;
  const fetchImpl = options.fetch || win.fetch;
  const math = options.math || Math;
  const now = options.now || (() => Date.now());
  const setTimeoutImpl = options.setTimeout || win.setTimeout.bind(win);
  const clearTimeoutImpl = options.clearTimeout || win.clearTimeout.bind(win);
  const setIntervalImpl = options.setInterval || win.setInterval.bind(win);
  const clearIntervalImpl = options.clearInterval || win.clearInterval.bind(win);
  const apiBase = options.apiBase || API_BASE;

  const deckEl = doc.getElementById("deck");
  const shuffleBtn = doc.getElementById("shuffleBtn");
  const likeBtn = doc.getElementById("likeBtn");
  const nopeBtn = doc.getElementById("nopeBtn");
  const superLikeBtn = doc.getElementById("superLikeBtn");

  let profiles = [];
  let pollIntervalId = null;
  let matchToastTimerId = null;

  function sample(arr) {
    return arr[Math.floor(math.random() * arr.length)];
  }

  function pickTags() {
    return Array.from(new Set(Array.from({ length: 4 }, () => sample(TAGS))));
  }

  function imgFor(seed) {
    return `https://images.unsplash.com/photo-${seed}?auto=format&fit=crop&w=1200&q=80`;
  }

  function generateProfiles(count = 12) {
    const generatedProfiles = [];
    for (let i = 0; i < count; i++) {
      const shuffled = [...UNSPLASH_SEEDS].sort(() => math.random() - 0.5);
      const photoCount = 2 + Math.floor(math.random() * 3);
      const photos = shuffled.slice(0, photoCount).map(imgFor);

      generatedProfiles.push({
        id: `p_${i}_${now().toString(36)}`,
        name: sample(FIRST_NAMES),
        age: 18 + Math.floor(math.random() * 22),
        city: sample(CITIES),
        title: sample(JOBS),
        bio: sample(BIOS),
        tags: pickTags(),
        photos,
      });
    }

    return generatedProfiles;
  }

  async function postDecision(profileId, decision, profile) {
    if (!fetchImpl) {
      return null;
    }

    try {
      const res = await fetchImpl(`${apiBase}/api/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, decision, profile }),
      });
      return await res.json();
    } catch {
      return null;
    }
  }

  function renderDeck() {
    if (!deckEl) {
      return;
    }

    deckEl.setAttribute("aria-busy", "true");
    deckEl.innerHTML = "";

    profiles.forEach((profile) => {
      const card = doc.createElement("article");
      card.className = "card";
      card.setAttribute("data-photos", JSON.stringify(profile.photos));
      card.setAttribute("data-photo-idx", "0");
      card.setAttribute("data-profile-id", profile.id);
      card.setAttribute(
        "data-profile",
        JSON.stringify({
          id: profile.id,
          name: profile.name,
          age: profile.age,
          city: profile.city,
          title: profile.title,
        })
      );

      const img = doc.createElement("img");
      img.className = "card__media";
      img.src = profile.photos[0];
      img.alt = `${profile.name} — profile photo`;

      const body = doc.createElement("div");
      body.className = "card__body";

      const titleRow = doc.createElement("div");
      titleRow.className = "title-row";
      titleRow.innerHTML = `
        <h2 class="card__title">${profile.name}</h2>
        <span class="card__age">${profile.age}</span>
      `;

      const meta = doc.createElement("div");
      meta.className = "card__meta";
      meta.textContent = `${profile.title} • ${profile.city}`;

      const chips = doc.createElement("div");
      chips.className = "card__chips";
      profile.tags.forEach((tag) => {
        const chip = doc.createElement("span");
        chip.className = "chip";
        chip.textContent = tag;
        chips.appendChild(chip);
      });

      body.appendChild(titleRow);
      body.appendChild(meta);
      body.appendChild(chips);

      card.appendChild(img);
      card.appendChild(body);
      deckEl.appendChild(card);
    });

    deckEl.removeAttribute("aria-busy");
  }

  function resetDeck() {
    profiles = generateProfiles(12);
    renderDeck();
  }

  function showMatchToast(name) {
    const toast = doc.getElementById("matchToast");
    if (!toast) {
      return;
    }

    toast.textContent = name ? `🔥 It's a Match with ${name}!` : "🔥 It's a Match!";
    toast.classList.remove("match-toast--visible");
    void toast.offsetWidth;
    toast.classList.add("match-toast--visible");

    if (matchToastTimerId) {
      clearTimeoutImpl(matchToastTimerId);
    }

    matchToastTimerId = setTimeoutImpl(() => {
      toast.classList.remove("match-toast--visible");
      matchToastTimerId = null;
    }, 2200);
  }

  async function pollForMatches() {
    if (!fetchImpl) {
      return;
    }

    try {
      const res = await fetchImpl(`${apiBase}/api/matches/poll`);
      const data = await res.json();
      if (data.matches && data.matches.length > 0) {
        data.matches.forEach((match, index) => {
          setTimeoutImpl(() => showMatchToast(match.profile?.name), index * 2400);
        });
      }
    } catch {
      // Server offline — fail silently.
    }
  }

  function setupTinderInteractions() {
    const SWIPE_X_THRESHOLD = 90;
    const SWIPE_Y_THRESHOLD = 90;
    const ROTATE_DEG = 12;
    const EXIT_MULT = 1.25;

    const cardElements = doc.getElementsByClassName("card");

    function getTopCard() {
      if (!cardElements || cardElements.length === 0) {
        return null;
      }

      return cardElements[cardElements.length - 1];
    }

    function nextPhoto(card) {
      if (!card) {
        return;
      }

      const img = card.querySelector("img");
      if (!img) {
        return;
      }

      const raw = card.getAttribute("data-photos");
      if (!raw) {
        return;
      }

      let photos;
      try {
        photos = JSON.parse(raw);
      } catch {
        return;
      }

      if (!Array.isArray(photos) || photos.length === 0) {
        return;
      }

      const idx = Number(card.getAttribute("data-photo-idx") || "0");
      const nextIdx = (idx + 1) % photos.length;
      card.setAttribute("data-photo-idx", String(nextIdx));
      img.src = photos[nextIdx];
    }

    function animateDecision(card, decision) {
      if (!card) {
        return;
      }

      const profileId = card.getAttribute("data-profile-id") || "";
      let profile = null;
      try {
        profile = JSON.parse(card.getAttribute("data-profile") || "null");
      } catch {
        profile = null;
      }

      const outX =
        decision === "like" ? win.innerWidth :
        decision === "nope" ? -win.innerWidth :
        0;
      const outY = decision === "superlike" ? -win.innerHeight : 0;
      const rotate =
        decision === "like" ? ROTATE_DEG :
        decision === "nope" ? -ROTATE_DEG :
        0;

      card.style.transition = "transform 260ms ease";
      card.style.transform = `translate(${outX * EXIT_MULT}px, ${outY * EXIT_MULT}px) rotate(${rotate}deg)`;

      postDecision(profileId, decision, profile).then((data) => {
        if (data && data.matched) {
          showMatchToast(profile?.name);
        }
      });

      if (decision === "superlike") {
        showMatchToast(profile?.name);
      }

      setTimeoutImpl(() => card.remove(), 260);
    }

    let startX = 0;
    let startY = 0;
    let dx = 0;
    let dy = 0;
    let dragging = false;
    let lastTapTime = 0;
    const DOUBLE_TAP_MS = 320;

    function onPointerDown(e) {
      const card = getTopCard();
      if (!card || !card.contains(e.target)) {
        return;
      }

      dragging = true;
      dx = 0;
      dy = 0;
      card.setPointerCapture?.(e.pointerId);
      startX = e.clientX;
      startY = e.clientY;
      card.style.transition = "none";

      const currentTime = now();
      if (currentTime - lastTapTime < DOUBLE_TAP_MS) {
        nextPhoto(card);
        lastTapTime = 0;
        dragging = false;
        card.style.transition = "";
        card.style.transform = "";
        return;
      }

      lastTapTime = currentTime;
    }

    function onPointerMove(e) {
      if (!dragging) {
        return;
      }

      const card = getTopCard();
      if (!card) {
        return;
      }

      dx = e.clientX - startX;
      dy = e.clientY - startY;
      const rotate = Math.max(-ROTATE_DEG, Math.min(ROTATE_DEG, dx / 18));
      card.style.transform = `translate(${dx}px, ${dy}px) rotate(${rotate}deg)`;
    }

    function onPointerUp() {
      if (!dragging) {
        return;
      }

      dragging = false;
      const card = getTopCard();
      if (!card) {
        return;
      }

      if (dx > SWIPE_X_THRESHOLD) {
        animateDecision(card, "like");
        return;
      }
      if (dx < -SWIPE_X_THRESHOLD) {
        animateDecision(card, "nope");
        return;
      }
      if (dy < -SWIPE_Y_THRESHOLD) {
        animateDecision(card, "superlike");
        return;
      }

      card.style.transition = "transform 220ms ease";
      card.style.transform = "translate(0px, 0px) rotate(0deg)";
    }

    doc.addEventListener("pointerdown", onPointerDown);
    doc.addEventListener("pointermove", onPointerMove);
    doc.addEventListener("pointerup", onPointerUp);
    doc.addEventListener("pointercancel", onPointerUp);

    const nopeClick = () => animateDecision(getTopCard(), "nope");
    const likeClick = () => animateDecision(getTopCard(), "like");
    const superLikeClick = () => animateDecision(getTopCard(), "superlike");

    nopeBtn?.addEventListener("click", nopeClick);
    likeBtn?.addEventListener("click", likeClick);
    superLikeBtn?.addEventListener("click", superLikeClick);

    return {
      getTopCard,
      nextPhoto,
      animateDecision,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      cleanup() {
        doc.removeEventListener("pointerdown", onPointerDown);
        doc.removeEventListener("pointermove", onPointerMove);
        doc.removeEventListener("pointerup", onPointerUp);
        doc.removeEventListener("pointercancel", onPointerUp);
        nopeBtn?.removeEventListener("click", nopeClick);
        likeBtn?.removeEventListener("click", likeClick);
        superLikeBtn?.removeEventListener("click", superLikeClick);
      },
      state() {
        return { dx, dy, dragging, lastTapTime };
      },
    };
  }

  shuffleBtn?.addEventListener("click", resetDeck);
  resetDeck();
  const interactions = setupTinderInteractions();
  pollIntervalId = setIntervalImpl(pollForMatches, 10000);

  return {
    API_BASE: apiBase,
    generateProfiles,
    postDecision,
    renderDeck,
    resetDeck,
    showMatchToast,
    pollForMatches,
    interactions,
    getProfiles() {
      return profiles.slice();
    },
    setProfiles(nextProfiles) {
      profiles = nextProfiles.slice();
      renderDeck();
    },
    cleanup() {
      if (pollIntervalId) {
        clearIntervalImpl(pollIntervalId);
        pollIntervalId = null;
      }
      if (matchToastTimerId) {
        clearTimeoutImpl(matchToastTimerId);
        matchToastTimerId = null;
      }
      shuffleBtn?.removeEventListener("click", resetDeck);
      interactions.cleanup();
    },
  };
}

const shouldAutoBoot = typeof window !== "undefined" && !window.__APP_DISABLE_AUTO_BOOT;
const appInstance = shouldAutoBoot ? createTinderApp() : null;

if (typeof window !== "undefined") {
  window.__APP_TEST_HOOKS = {
    TAGS,
    createTinderApp,
    instance: appInstance,
  };
}
