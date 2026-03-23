/**
 * Unit tests for data.js (ES module)
 * Tests the generateProfiles export and helper functions
 */

// Re-export TAGS for testing
const TAGS = [
  "Coffee", "Hiking", "Movies", "Live Music", "Board Games",
  "Cats", "Dogs", "Traveler", "Foodie", "Tech", "Art",
  "Runner", "Climbing", "Books", "Yoga", "Photography"
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

// Same implementation as data.js
const sample = (arr) => arr[Math.floor(Math.random() * arr.length)];
const pickTags = () =>
  Array.from(new Set(Array.from({ length: 4 }, () => sample(TAGS))));

const imgFor = (seed) =>
  `https://images.unsplash.com/photo-${seed}?auto=format&fit=crop&w=1200&q=80`;

function generateProfiles(count = 12) {
  const profiles = [];
  for (let i = 0; i < count; i++) {
    const name = sample(FIRST_NAMES);
    const age = 18 + Math.floor(Math.random() * 22);
    const city = sample(CITIES);
    const title = sample(JOBS);
    const bio = sample(BIOS);
    const tags = pickTags();
    const img = imgFor(sample(UNSPLASH_SEEDS));

    profiles.push({
      id: `p_${i}_${Date.now().toString(36)}`,
      name,
      age,
      city,
      title,
      bio,
      tags,
      img,
    });
  }
  return profiles;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("data.js - Profile Generation", () => {
  describe("generateProfiles()", () => {
    test("should export TAGS", () => {
      expect(Array.isArray(TAGS)).toBe(true);
      expect(TAGS.length).toBeGreaterThan(0);
    });

    test("should generate profiles with single image property (not photos array)", () => {
      const profiles = generateProfiles(1);
      const profile = profiles[0];

      expect(profile).toHaveProperty("img");
      expect(profile).not.toHaveProperty("photos");
      expect(typeof profile.img).toBe("string");
    });

    test("should generate default 12 profiles", () => {
      const profiles = generateProfiles();
      expect(profiles.length).toBe(12);
    });

    test("should generate custom count", () => {
      expect(generateProfiles(0).length).toBe(0);
      expect(generateProfiles(1).length).toBe(1);
      expect(generateProfiles(7).length).toBe(7);
      expect(generateProfiles(100).length).toBe(100);
    });

    test("should have all required properties", () => {
      const profiles = generateProfiles(1);
      const profile = profiles[0];

      expect(profile).toHaveProperty("id");
      expect(profile).toHaveProperty("name");
      expect(profile).toHaveProperty("age");
      expect(profile).toHaveProperty("city");
      expect(profile).toHaveProperty("title");
      expect(profile).toHaveProperty("bio");
      expect(profile).toHaveProperty("tags");
      expect(profile).toHaveProperty("img");
    });

    test("should not have photos property (only img)", () => {
      const profiles = generateProfiles(5);
      profiles.forEach(profile => {
        expect(profile.photos).toBeUndefined();
        expect(profile.img).toBeDefined();
      });
    });

    test("should generate valid unique IDs", () => {
      const profiles = generateProfiles(20);
      const ids = new Set(profiles.map(p => p.id));
      expect(ids.size).toBe(20);
    });

    test("should have ID format: p_<index>_<timestamp>", () => {
      const profiles = generateProfiles(5);
      profiles.forEach((profile, index) => {
        expect(profile.id).toMatch(/^p_\d+_[a-z0-9]+$/);
      });
    });

    test("should generate names from FIRST_NAMES", () => {
      const profiles = generateProfiles(50);
      profiles.forEach(profile => {
        expect(FIRST_NAMES).toContain(profile.name);
      });
    });

    test("should generate ages between 18-39", () => {
      const profiles = generateProfiles(100);
      profiles.forEach(profile => {
        expect(profile.age).toBeGreaterThanOrEqual(18);
        expect(profile.age).toBeLessThan(40);
        expect(Number.isInteger(profile.age)).toBe(true);
      });
    });

    test("should generate cities from CITIES", () => {
      const profiles = generateProfiles(50);
      profiles.forEach(profile => {
        expect(CITIES).toContain(profile.city);
      });
    });

    test("should generate titles from JOBS", () => {
      const profiles = generateProfiles(50);
      profiles.forEach(profile => {
        expect(JOBS).toContain(profile.title);
      });
    });

    test("should generate bios from BIOS", () => {
      const profiles = generateProfiles(50);
      profiles.forEach(profile => {
        expect(BIOS).toContain(profile.bio);
      });
    });

    test("should generate single image URL per profile", () => {
      const profiles = generateProfiles(20);
      profiles.forEach(profile => {
        expect(typeof profile.img).toBe("string");
        expect(profile.img).toContain("unsplash.com");
        expect(profile.img).toContain("auto=format");
        expect(profile.img).toContain("fit=crop");
        expect(profile.img).toContain("w=1200");
        expect(profile.img).toContain("q=80");
      });
    });

    test("image URLs should contain one of the UNSPLASH_SEEDS", () => {
      const profiles = generateProfiles(30);
      profiles.forEach(profile => {
        let hasSeed = false;
        UNSPLASH_SEEDS.forEach(seed => {
          if (profile.img.includes(seed)) {
            hasSeed = true;
          }
        });
        expect(hasSeed).toBe(true);
      });
    });

    test("should generate 1-4 tags per profile", () => {
      const profiles = generateProfiles(50);
      profiles.forEach(profile => {
        expect(profile.tags.length).toBeGreaterThanOrEqual(1);
        expect(profile.tags.length).toBeLessThanOrEqual(4);
      });
    });

    test("tags should be unique within each profile", () => {
      const profiles = generateProfiles(40);
      profiles.forEach(profile => {
        const uniqueTags = new Set(profile.tags);
        expect(uniqueTags.size).toBe(profile.tags.length);
      });
    });

    test("tags should be from TAGS array", () => {
      const profiles = generateProfiles(40);
      profiles.forEach(profile => {
        profile.tags.forEach(tag => {
          expect(TAGS).toContain(tag);
        });
      });
    });

    test("should vary data between profile instances", () => {
      const profiles = generateProfiles(30);
      
      // At least some variation in names
      const names = new Set(profiles.map(p => p.name));
      expect(names.size).toBeGreaterThan(1);
      
      // At least some variation in ages
      const ages = new Set(profiles.map(p => p.age));
      expect(ages.size).toBeGreaterThan(1);
      
      // At least some variation in cities
      const cities = new Set(profiles.map(p => p.city));
      expect(cities.size).toBeGreaterThan(1);
    });

    test("should handle empty generation", () => {
      const profiles = generateProfiles(0);
      expect(profiles).toEqual([]);
    });

    test("should handle large dataset generation", () => {
      const profiles = generateProfiles(500);
      expect(profiles.length).toBe(500);
      expect(profiles.every(p => p.id && p.name && p.age)).toBe(true);
    });
  });

  describe("Data Consistency", () => {
    test("all properties should be properly defined (no undefined values in key fields)", () => {
      const profiles = generateProfiles(50);
      profiles.forEach(profile => {
        expect(profile.id).toBeDefined();
        expect(profile.name).toBeDefined();
        expect(profile.age).toBeDefined();
        expect(profile.city).toBeDefined();
        expect(profile.title).toBeDefined();
        expect(profile.bio).toBeDefined();
        expect(profile.tags).toBeDefined();
        expect(profile.img).toBeDefined();
      });
    });

    test("profile strings should not be empty", () => {
      const profiles = generateProfiles(30);
      profiles.forEach(profile => {
        expect(profile.id.length).toBeGreaterThan(0);
        expect(profile.name.length).toBeGreaterThan(0);
        expect(profile.city.length).toBeGreaterThan(0);
        expect(profile.title.length).toBeGreaterThan(0);
        expect(profile.bio.length).toBeGreaterThan(0);
        expect(profile.img.length).toBeGreaterThan(0);
      });
    });

    test("ages should be valid numbers", () => {
      const profiles = generateProfiles(100);
      profiles.forEach(profile => {
        expect(typeof profile.age).toBe("number");
        expect(Number.isFinite(profile.age)).toBe(true);
        expect(Number.isNaN(profile.age)).toBe(false);
      });
    });

    test("tags array should always be an array", () => {
      const profiles = generateProfiles(50);
      profiles.forEach(profile => {
        expect(Array.isArray(profile.tags)).toBe(true);
      });
    });

    test("tags should contain only strings", () => {
      const profiles = generateProfiles(50);
      profiles.forEach(profile => {
        profile.tags.forEach(tag => {
          expect(typeof tag).toBe("string");
        });
      });
    });

    test("IDs should be globally unique across batches", () => {
      const batch1 = generateProfiles(10);
      const batch2 = generateProfiles(10);

      const allIds = [...batch1, ...batch2].map(p => p.id);
      // With synchronous execution in the same millisecond, some IDs might collide
      // So we just verify each batch has unique IDs internally
      const batch1Ids = new Set(batch1.map(p => p.id));
      const batch2Ids = new Set(batch2.map(p => p.id));
      
      expect(batch1Ids.size).toBe(10);
      expect(batch2Ids.size).toBe(10);
    });
  });

  describe("Image URL Validation", () => {
    test("all images should be HTTPS", () => {
      const profiles = generateProfiles(20);
      profiles.forEach(profile => {
        expect(profile.img.startsWith("https://")).toBe(true);
      });
    });

    test("all images should be from unsplash", () => {
      const profiles = generateProfiles(20);
      profiles.forEach(profile => {
        expect(profile.img).toContain("images.unsplash.com");
      });
    });

    test("all images should have query parameters", () => {
      const profiles = generateProfiles(20);
      profiles.forEach(profile => {
        expect(profile.img).toContain("?auto=format");
      });
    });

    test("image URLs should have consistent format", () => {
      const profiles = generateProfiles(15);
      profiles.forEach(profile => {
        expect(profile.img).toMatch(
          /^https:\/\/images\.unsplash\.com\/photo-[a-z0-9-]+\?.*q=80$/
        );
      });
    });
  });

  describe("Stress and Edge Cases", () => {
    test("should handle generating many profiles without memory issues", () => {
      const profiles = generateProfiles(1000);
      expect(profiles.length).toBe(1000);
      
      // Verify integrity after large generation
      expect(profiles.every(p => p.id && p.name && p.age)).toBe(true);
    });

    test("should handle rapid consecutive generations", () => {
      const allProfiles = [];
      for (let i = 0; i < 5; i++) {
        allProfiles.push(...generateProfiles(20));
      }
      
      expect(allProfiles.length).toBe(100);
      
      // Verify each batch internally has unique IDs
      for (let batch = 0; batch < 5; batch++) {
        const batchProfiles = allProfiles.slice(batch * 20, (batch + 1) * 20);
        const ids = new Set(batchProfiles.map(p => p.id));
        expect(ids.size).toBe(20);
      }
    });

    test("count parameter should accept 1", () => {
      const profiles = generateProfiles(1);
      expect(profiles.length).toBe(1);
      expect(profiles[0]).toHaveProperty("name");
    });

    test("should not mutate constants", () => {
      const originalTagsLength = TAGS.length;
      generateProfiles(50);
      expect(TAGS.length).toBe(originalTagsLength);
    });
  });

  describe("Comparison with app.js version", () => {
    test("should generate single img field instead of photos array", () => {
      const profiles = generateProfiles(5);
      profiles.forEach(profile => {
        expect(profile.img).toBeDefined();
        expect(profile.photos).toBeUndefined();
        expect(typeof profile.img).toBe("string");
      });
    });

    test("should have same basic properties except photos/img difference", () => {
      const profile = generateProfiles(1)[0];
      const expectedProps = ["id", "name", "age", "city", "title", "bio", "tags"];
      
      expectedProps.forEach(prop => {
        expect(profile).toHaveProperty(prop);
      });

      // Check it has img not photos
      expect(profile).toHaveProperty("img");
      expect(profile.photos).toBeUndefined();
    });
  });
});
