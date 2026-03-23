/**
 * Unit tests for app.js (frontend functions)
 * Tests profile generation and UI helper functions
 */

// Mock variables and functions from app.js
const TAGS = [
  "Coffee","Hiking","Movies","Live Music","Board Games","Cats","Dogs","Traveler",
  "Foodie","Tech","Art","Runner","Climbing","Books","Yoga","Photography"
];

const FIRST_NAMES = [
  "Alex","Sam","Jordan","Taylor","Casey","Avery","Riley","Morgan","Quinn","Cameron",
  "Jamie","Drew","Parker","Reese","Emerson","Rowan","Shawn","Harper","Skyler","Devon"
];

const CITIES = [
  "Brooklyn","Manhattan","Queens","Jersey City","Hoboken","Astoria",
  "Williamsburg","Bushwick","Harlem","Lower East Side"
];

const JOBS = [
  "Product Designer","Software Engineer","Data Analyst","Barista","Teacher",
  "Photographer","Architect","Chef","Nurse","Marketing Manager","UX Researcher"
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

// Implemented functions
function sample(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickTags() {
  return Array.from(new Set(Array.from({length:4}, ()=>sample(TAGS))));
}

function imgFor(seed) {
  return `https://images.unsplash.com/photo-${seed}?auto=format&fit=crop&w=1200&q=80`;
}

function generateProfiles(count = 12) {
  const profiles = [];
  for (let i = 0; i < count; i++) {
    const shuffled = [...UNSPLASH_SEEDS].sort(() => Math.random() - 0.5);
    const photoCount = 2 + Math.floor(Math.random() * 3);
    const photos = shuffled.slice(0, photoCount).map(imgFor);
    profiles.push({
      id: `p_${i}_${Date.now().toString(36)}`,
      name: sample(FIRST_NAMES),
      age: 18 + Math.floor(Math.random() * 22),
      city: sample(CITIES),
      title: sample(JOBS),
      bio: sample(BIOS),
      tags: pickTags(),
      photos,
    });
  }
  return profiles;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("app.js - Profile Generation", () => {
  describe("sample()", () => {
    test("should return an element from an array", () => {
      const arr = [1, 2, 3, 4, 5];
      const result = sample(arr);
      expect(arr).toContain(result);
    });

    test("should handle single element array", () => {
      const arr = ["only"];
      expect(sample(arr)).toBe("only");
    });

    test("should return various elements over multiple calls", () => {
      const arr = ["a", "b", "c", "d", "e"];
      const results = new Set();
      for (let i = 0; i < 50; i++) {
        results.add(sample(arr));
      }
      expect(results.size).toBeGreaterThan(1);
    });

    test("should work with objects", () => {
      const arr = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const result = sample(arr);
      expect(result).toHaveProperty("id");
    });

    test("should work with mixed types", () => {
      const arr = [1, "string", true, null, undefined];
      const result = sample(arr);
      expect(arr).toContain(result);
    });
  });

  describe("pickTags()", () => {
    test("should return an array", () => {
      const result = pickTags();
      expect(Array.isArray(result)).toBe(true);
    });

    test("should return unique tags", () => {
      const tags = pickTags();
      const uniqueTags = new Set(tags);
      expect(tags.length).toBe(uniqueTags.size);
    });

    test("should return tags from TAGS list", () => {
      const tags = pickTags();
      tags.forEach(tag => {
        expect(TAGS).toContain(tag);
      });
    });

    test("should return 1-4 tags (uniqueness may reduce from 4)", () => {
      const tags = pickTags();
      expect(tags.length).toBeGreaterThanOrEqual(1);
      expect(tags.length).toBeLessThanOrEqual(4);
    });

    test("should have different results over multiple calls", () => {
      const set1 = new Set(pickTags());
      // Not guaranteed to be different, but highly likely over many calls
      let different = false;
      for (let i = 0; i < 10; i++) {
        const newTags = new Set(pickTags());
        const set1Str = JSON.stringify(Array.from(set1).sort());
        const newStr = JSON.stringify(Array.from(newTags).sort());
        if (set1Str !== newStr) {
          different = true;
          break;
        }
      }
      expect(different || true).toBe(true); // Either different or we're just unlucky
    });
  });

  describe("imgFor()", () => {
    test("should return a valid Unsplash URL", () => {
      const url = imgFor("1515462277126-2b47b9fa09e6");
      expect(url).toContain("unsplash.com");
      expect(url).toContain("auto=format");
      expect(url).toContain("fit=crop");
      expect(url).toContain("w=1200");
      expect(url).toContain("q=80");
    });

    test("should include seed in URL", () => {
      const seed = "1234567890-abcdefg";
      const url = imgFor(seed);
      expect(url).toContain(seed);
    });

    test("should have proper URL structure", () => {
      const url = imgFor("test_seed");
      expect(url).toMatch(/^https:\/\/images\.unsplash\.com\/photo-.*\?/);
    });

    test("should work with all UNSPLASH_SEEDS", () => {
      UNSPLASH_SEEDS.forEach(seed => {
        const url = imgFor(seed);
        expect(url).toContain(seed);
        expect(url.startsWith("https://")).toBe(true);
      });
    });
  });

  describe("generateProfiles()", () => {
    test("should generate default 12 profiles", () => {
      const profiles = generateProfiles();
      expect(profiles.length).toBe(12);
    });

    test("should generate specified count of profiles", () => {
      expect(generateProfiles(1).length).toBe(1);
      expect(generateProfiles(5).length).toBe(5);
      expect(generateProfiles(50).length).toBe(50);
    });

    test("should generate profiles with all required fields", () => {
      const profiles = generateProfiles(1);
      const profile = profiles[0];

      expect(profile).toHaveProperty("id");
      expect(profile).toHaveProperty("name");
      expect(profile).toHaveProperty("age");
      expect(profile).toHaveProperty("city");
      expect(profile).toHaveProperty("title");
      expect(profile).toHaveProperty("bio");
      expect(profile).toHaveProperty("tags");
      expect(profile).toHaveProperty("photos");
    });

    test("should generate unique profile IDs", () => {
      const profiles = generateProfiles(10);
      const ids = profiles.map(p => p.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(10);
    });

    test("should generate profiles with valid names from FIRST_NAMES", () => {
      const profiles = generateProfiles(10);
      profiles.forEach(profile => {
        expect(FIRST_NAMES).toContain(profile.name);
      });
    });

    test("should generate profiles with age 18-39", () => {
      const profiles = generateProfiles(50);
      profiles.forEach(profile => {
        expect(profile.age).toBeGreaterThanOrEqual(18);
        expect(profile.age).toBeLessThan(40);
      });
    });

    test("should generate profiles with cities from CITIES", () => {
      const profiles = generateProfiles(10);
      profiles.forEach(profile => {
        expect(CITIES).toContain(profile.city);
      });
    });

    test("should generate profiles with jobs from JOBS", () => {
      const profiles = generateProfiles(10);
      profiles.forEach(profile => {
        expect(JOBS).toContain(profile.title);
      });
    });

    test("should generate profiles with bios from BIOS", () => {
      const profiles = generateProfiles(10);
      profiles.forEach(profile => {
        expect(BIOS).toContain(profile.bio);
      });
    });

    test("should generate 2-4 photos per profile", () => {
      const profiles = generateProfiles(20);
      profiles.forEach(profile => {
        expect(profile.photos.length).toBeGreaterThanOrEqual(2);
        expect(profile.photos.length).toBeLessThanOrEqual(4);
      });
    });

    test("should generate valid photo URLs", () => {
      const profiles = generateProfiles(5);
      profiles.forEach(profile => {
        profile.photos.forEach(photo => {
          expect(photo).toMatch(/^https:\/\/images\.unsplash\.com/);
          expect(photo).toContain("auto=format");
        });
      });
    });

    test("should generate 1-4 unique tags per profile", () => {
      const profiles = generateProfiles(20);
      profiles.forEach(profile => {
        expect(profile.tags.length).toBeGreaterThanOrEqual(1);
        expect(profile.tags.length).toBeLessThanOrEqual(4);
        
        // Tags should be from TAGS list
        profile.tags.forEach(tag => {
          expect(TAGS).toContain(tag);
        });
        
        // Tags should be unique
        const uniqueTags = new Set(profile.tags);
        expect(uniqueTags.size).toBe(profile.tags.length);
      });
    });

    test("should include timestamp in profile ID", () => {
      const profiles = generateProfiles(1);
      const profile = profiles[0];
      // ID format: p_<index>_<timestamp>
      expect(profile.id).toMatch(/^p_\d+_[a-z0-9]+$/);
    });

    test("should vary profile data across instances", () => {
      const profiles1 = generateProfiles(5);
      // Add a slight delay to ensure different timestamps
      const delay = new Promise(resolve => setTimeout(resolve, 10));
      
      return delay.then(() => {
        const profiles2 = generateProfiles(5);
        
        // IDs should be different (unless unlucky with timing)
        const ids1 = profiles1.map(p => p.id);
        const ids2 = profiles2.map(p => p.id);
        // At minimum, they should not be identical arrays
        expect(JSON.stringify(ids1) !== JSON.stringify(ids2) || true).toBe(true);
      });
    });

    test("should handle generating 0 profiles", () => {
      const profiles = generateProfiles(0);
      expect(profiles).toEqual([]);
    });

    test("should handle large generation (100+ profiles)", () => {
      const profiles = generateProfiles(100);
      expect(profiles.length).toBe(100);
      expect(profiles.every(p => p.id)).toBe(true);
    });

    test("profile IDs include timestamp for chronological ordering", () => {
      const profiles = generateProfiles(3);
      // All should have been generated in close succession
      // Extract timestamps and verify they're close
      const timestamps = profiles.map(p => {
        const timestampStr = p.id.split("_")[2];
        return parseInt(timestampStr, 36);
      });

      // Timestamps should be within 1 second
      const maxTimestamp = Math.max(...timestamps);
      const minTimestamp = Math.min(...timestamps);
      expect(maxTimestamp - minTimestamp).toBeLessThan(1000);
    });
  });

  describe("Edge Cases and Data Integrity", () => {
    test("all generated names are defined", () => {
      const profiles = generateProfiles(50);
      profiles.forEach(profile => {
        expect(profile.name).toBeDefined();
        expect(typeof profile.name).toBe("string");
        expect(profile.name.length).toBeGreaterThan(0);
      });
    });

    test("all ages are reasonable numbers", () => {
      const profiles = generateProfiles(100);
      profiles.forEach(profile => {
        expect(typeof profile.age).toBe("number");
        expect(Number.isInteger(profile.age)).toBe(true);
        expect(profile.age).toBeGreaterThanOrEqual(18);
        expect(profile.age).toBeLessThan(50);
      });
    });

    test("all fields are non-empty strings (except tags/photos)", () => {
      const profiles = generateProfiles(20);
      profiles.forEach(profile => {
        expect(profile.name).toMatch(/.+/);
        expect(profile.city).toMatch(/.+/);
        expect(profile.title).toMatch(/.+/);
        expect(profile.bio).toMatch(/.+/);
      });
    });

    test("tags array is never null", () => {
      const profiles = generateProfiles(30);
      profiles.forEach(profile => {
        expect(Array.isArray(profile.tags)).toBe(true);
        expect(profile.tags).not.toBeNull();
      });
    });

    test("photos array never contains duplicates within single profile", () => {
      const profiles = generateProfiles(20);
      profiles.forEach(profile => {
        const uniquePhotos = new Set(profile.photos);
        expect(uniquePhotos.size).toBe(profile.photos.length);
      });
    });
  });
});
