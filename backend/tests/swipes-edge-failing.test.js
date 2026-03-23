'use strict';

/**
 * INTENTIONALLY FAILING edge-case tests for PR #9 (FardeenI/ai-tinder-fork)
 *
 * Each test below is written against a REASONABLE expectation that the current
 * code does NOT satisfy.  Every test here is expected to FAIL.  The failure
 * message explains what the code actually does vs. what a caller would expect.
 *
 * Bugs / gaps exposed:
 *  [A] `action` is not trimmed — inconsistent with profileId / profileName
 *  [B] Zero-width space U+200B is not caught by .trim() → invisible strings pass validation
 *  [C] GET /api/swipes never returns a `matched` field (not stored, not selected)
 *  [D] POST response never echoes the submitted `userId` back to the caller
 *  [E] Duplicate profileId swipes are silently accepted — no 409 Conflict
 *  [F] GET /api/swipes returns newest-first; a caller expecting oldest-first is surprised
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.DB_PATH = ':memory:';

const app = require('../server');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let server;
let baseUrl;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url     = new URL(path, baseUrl);
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const opts = {
      method,
      hostname: url.hostname,
      port:     url.port,
      path:     url.pathname,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

before(() => new Promise(resolve => {
  server = app.listen(0, () => {
    baseUrl = `http://localhost:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise(resolve => {
  server.closeAllConnections();
  server.close(resolve);
}));

const db = require('../db');
beforeEach(() => db.exec('DELETE FROM swipes'));

// ===========================================================================
// [A] action is not trimmed — inconsistent with profileId / profileName
//
// Both profileId and profileName are trimmed before validation:
//   const cleanId   = profileId.trim();
//   const cleanName = profileName.trim();
//
// But action goes straight into VALID_ACTIONS.has(action) with NO trim.
// So " like " (with surrounding spaces) fails the Set lookup and returns 400,
// even though "like" is a perfectly valid action.
//
// Expected (reasonable): the server trims action and returns 201.
// Actual:                400 — action does not pass VALID_ACTIONS.has check.
// ===========================================================================

describe('[FAIL] action trimming inconsistency', () => {

  it('BUG [A1]: action " like " with leading/trailing spaces should be accepted like profileId trimming — gets 400 instead', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId:   'p_0_abc',
      profileName: 'Alex',
      action:      ' like ',   // spaces around a valid action
    });
    // Reasonable expectation: server trims and accepts it → 201
    // Actual: 400 because VALID_ACTIONS.has(' like ') is false
    assert.equal(res.status, 201, `Expected 201 (action trimmed like profileId is), got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  it('BUG [A2]: action " nope " with trailing space should be accepted — gets 400 instead', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId:   'p_1_abc',
      profileName: 'Sam',
      action:      ' nope ',
    });
    assert.equal(res.status, 201, `Expected 201 (nope with spaces trimmed), got ${res.status}`);
  });

  it('BUG [A3]: action "Like" (capitalised first letter) should be case-normalised to "like" — gets 400 instead', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId:   'p_2_abc',
      profileName: 'Jordan',
      action:      'Like',    // first-letter caps, common client mistake
    });
    // Expectation: server lowercases and accepts → 201
    // Actual: 400 — VALID_ACTIONS is case-sensitive, "Like" is not in the set
    assert.equal(res.status, 201, `Expected 201 (case-normalised action), got ${res.status}`);
  });

});

// ===========================================================================
// [B] Zero-width space U+200B passes .trim() — invisible strings sneak through
//
// JavaScript's String.prototype.trim() removes ECMAScript WhiteSpace characters
// (SP, TAB, NBSP, ZWNBSP, and Unicode Space_Separator category).
// U+200B ZERO WIDTH SPACE has Unicode category Cf (Format), not Zs, so
// .trim() does NOT remove it.
//
// Result: profileId / profileName containing only U+200B passes the
// `profileId.trim() === ''` guard and is stored as a visually-empty string.
//
// Expected (reasonable): 400 — the string is functionally invisible.
// Actual:                201 — stored in the database.
// ===========================================================================

describe('[FAIL] zero-width space bypasses validation', () => {

  it('BUG [B1]: profileId of only zero-width spaces should be rejected — gets 201 instead', async () => {
    const invisibleId = '\u200B\u200B\u200B';   // three zero-width spaces
    const res = await request('POST', '/api/swipes', {
      profileId:   invisibleId,
      profileName: 'Alex',
      action:      'like',
    });
    // Expectation: server should catch an effectively empty string → 400
    // Actual: trim() leaves '\u200B\u200B\u200B' intact → passes → 201
    assert.equal(res.status, 400, `Expected 400 (invisible profileId), got ${res.status} with body ${JSON.stringify(res.body)}`);
  });

  it('BUG [B2]: profileName of only zero-width space should be rejected — gets 201 instead', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId:   'p_valid',
      profileName: '\u200B',   // looks blank when rendered
      action:      'nope',
    });
    assert.equal(res.status, 400, `Expected 400 (invisible profileName), got ${res.status}`);
  });

  it('BUG [B3]: mixing zero-width spaces with real whitespace still bypasses trim — stored as non-empty', async () => {
    // ' \u200B ' → trim() removes the surrounding regular spaces but leaves U+200B
    // so the trimmed result is '\u200B' — non-empty, passes validation
    const res = await request('POST', '/api/swipes', {
      profileId:   ' \u200B ',
      profileName: 'Alex',
      action:      'like',
    });
    assert.equal(res.status, 400, `Expected 400 (only zero-width space remains after trim), got ${res.status}`);
  });

});

// ===========================================================================
// [C] GET /api/swipes never includes a `matched` field
//
// POST /api/swipes returns `matched: true/false` in its response, but the
// match result is NOT stored in the database (the swipes table has no
// `matched` column).  Therefore GET /api/swipes cannot and does not return it.
//
// A caller who uses the POST response to show "It's a Match!" and then later
// fetches GET to replay history would find no record of which swipes matched.
//
// Expected (reasonable): each record in GET /api/swipes includes `matched`.
// Actual:                the `matched` key is absent — undefined in JS.
// ===========================================================================

describe('[FAIL] GET /api/swipes missing matched field', () => {

  it('BUG [C1]: GET /api/swipes record should include matched field — it is missing', async () => {
    await request('POST', '/api/swipes', {
      profileId: 'p_0_abc', profileName: 'Alex', action: 'like',
    });
    const res = await request('GET', '/api/swipes');
    const swipe = res.body.swipes[0];
    // Reasonable expectation: matched is stored and returned
    // Actual: matched is undefined (column does not exist in table)
    assert.ok(
      'matched' in swipe,
      `Expected swipe record to contain "matched" field, got keys: ${Object.keys(swipe).join(', ')}`
    );
  });

  it('BUG [C2]: GET /api/swipes record matched value should be a boolean — it is undefined', async () => {
    await request('POST', '/api/swipes', {
      profileId: 'p_1_abc', profileName: 'Sam', action: 'superlike',
    });
    const res = await request('GET', '/api/swipes');
    const { matched } = res.body.swipes[0];
    assert.equal(typeof matched, 'boolean', `Expected typeof matched to be "boolean", got "${typeof matched}"`);
  });

});

// ===========================================================================
// [D] POST response does not echo userId back to the caller
//
// The request body includes `userId` to tie the swipe to a browser session.
// The POST response returns { id, profileId, profileName, action, swipedAt,
// matched } — but NOT userId.
//
// A client that submits userId to confirm it was accepted will find it absent.
//
// Expected (reasonable): POST response includes the userId that was submitted.
// Actual:                userId key is absent from the response body.
// ===========================================================================

describe('[FAIL] POST response missing userId echo', () => {

  it('BUG [D1]: POST response should echo submitted userId — it is missing', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId:   'p_0_abc',
      profileName: 'Alex',
      action:      'like',
      userId:      'u_test_123',
    });
    assert.equal(res.status, 201);
    assert.ok(
      'userId' in res.body,
      `Expected response to include "userId", got keys: ${Object.keys(res.body).join(', ')}`
    );
  });

  it('BUG [D2]: echoed userId in POST response should match what was submitted', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId:   'p_0_abc',
      profileName: 'Alex',
      action:      'nope',
      userId:      'u_session_xyz',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.userId, 'u_session_xyz',
      `Expected res.body.userId === "u_session_xyz", got: ${res.body.userId}`);
  });

});

// ===========================================================================
// [E] Duplicate profileId swipes are silently accepted — no conflict response
//
// The `swipes` table has no UNIQUE constraint on `profile_id`.  Swiping the
// same profile twice stores two rows and returns 201 both times.
//
// A well-designed API would return 409 Conflict on the second swipe to
// prevent accidentally double-counting a user's decisions.
//
// Expected (reasonable): second swipe on same profileId → 409 Conflict.
// Actual:                second swipe → 201 Created (duplicate row inserted).
// ===========================================================================

describe('[FAIL] duplicate swipe should return 409 Conflict', () => {

  it('BUG [E1]: second swipe for the same profileId should return 409 — gets 201 instead', async () => {
    const payload = { profileId: 'p_dup', profileName: 'Morgan', action: 'like' };
    const first  = await request('POST', '/api/swipes', payload);
    assert.equal(first.status, 201);

    const second = await request('POST', '/api/swipes', payload);
    // Reasonable expectation: server detects duplicate and rejects with 409
    // Actual: second swipe is accepted with 201 and a new DB row is created
    assert.equal(second.status, 409,
      `Expected 409 Conflict on duplicate swipe, got ${second.status}: ${JSON.stringify(second.body)}`);
  });

  it('BUG [E2]: GET /api/swipes/stats should not double-count if same profile swiped twice', async () => {
    const payload = { profileId: 'p_dc', profileName: 'Riley', action: 'like' };
    await request('POST', '/api/swipes', payload);
    await request('POST', '/api/swipes', payload);  // duplicate

    const res = await request('GET', '/api/swipes/stats');
    // Reasonable expectation: only the first swipe counts → like: 1
    // Actual: both rows counted → like: 2
    assert.equal(res.body.like, 1,
      `Expected like count of 1 (deduplicated), got ${res.body.like}`);
  });

});

// ===========================================================================
// [F] GET /api/swipes ordering — newest-first surprises callers expecting chronological
//
// The query uses ORDER BY id DESC so the most recent swipe is first.
// A caller iterating the array and expecting chronological (oldest-first)
// order will display history backwards.
//
// Expected (reasonable): oldest swipe first (chronological order).
// Actual:                newest swipe first (reverse-chronological).
// ===========================================================================

describe('[FAIL] GET /api/swipes ordering expectation', () => {

  it('BUG [F1]: swipes should be returned oldest-first (chronological) — they come newest-first', async () => {
    await request('POST', '/api/swipes', { profileId: 'p_first',  profileName: 'A', action: 'like' });
    await request('POST', '/api/swipes', { profileId: 'p_second', profileName: 'B', action: 'nope' });

    const res = await request('GET', '/api/swipes');
    // Reasonable expectation: chronological order → p_first is index 0
    // Actual: reverse order → p_second is index 0
    assert.equal(res.body.swipes[0].profileId, 'p_first',
      `Expected first swipe to be "p_first" (oldest), got "${res.body.swipes[0].profileId}" (newest returned first)`);
  });

});
